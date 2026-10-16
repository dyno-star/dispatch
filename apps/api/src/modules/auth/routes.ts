// Phone OTP login: request a code, exchange it for a session, refresh and log out.
// See docs/api/step-1-auth-and-riders.md.

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { normalizeNigerianPhone } from "@dispatch/shared";
import type { AppDeps } from "../../deps.js";
import { withTransaction } from "../../db/pool.js";
import { badRequest, tooManyRequests } from "../../http/errors.js";
import type { AuthUser } from "../../http/auth-guard.js";
import { createUser, lockPhone } from "../users/users.js";
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_COOLDOWN_SEC,
  OTP_TTL_SEC,
  generateOtp,
  hashOtp,
  otpMatches,
  otpMessage,
} from "./otp.js";
import { issueSession, revokeSession, rotateSession } from "./session.js";

const otpBody = z.object({ phone: z.string() });
const verifyBody = z.object({
  phone: z.string(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  name: z.string().trim().min(1).max(100).optional(),
});
const refreshBody = z.object({ refreshToken: z.string().min(1) });

function parsePhone(input: string): string {
  const phone = normalizeNigerianPhone(input);
  if (!phone) throw badRequest("invalid_phone", "Enter a valid Nigerian mobile number");
  return phone;
}

export function authRoutes(deps: AppDeps): FastifyPluginAsync {
  return async (app) => {
    // Per-IP limit, on top of the per-phone limits below.
    const rateLimit = { max: deps.authRateLimitPerHour ?? 20, timeWindow: "1 hour" };

    app.post("/otp", { config: { rateLimit } }, async (req) => {
      const phone = parsePhone(otpBody.parse(req.body).phone);
      const code = generateOtp();

      const otpId = await withTransaction(deps.db, async (client) => {
        await lockPhone(client, phone);
        const { rows } = await client.query<{ last_cooldown: number; last_hour: number }>(
          `SELECT count(*) FILTER (WHERE created_at > now() - make_interval(secs => $2))::int AS last_cooldown,
                  count(*)::int AS last_hour
           FROM otp_codes
           WHERE phone = $1 AND created_at > now() - interval '1 hour'`,
          [phone, OTP_RESEND_COOLDOWN_SEC],
        );
        const recent = rows[0]!;
        if (recent.last_cooldown > 0) {
          throw tooManyRequests("otp_cooldown", `Wait ${OTP_RESEND_COOLDOWN_SEC} seconds before requesting another code`);
        }
        if (recent.last_hour >= OTP_MAX_PER_HOUR) {
          throw tooManyRequests("otp_limit", "Too many codes requested. Try again later.");
        }
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO otp_codes (phone, code_hash, expires_at)
           VALUES ($1, $2, now() + make_interval(secs => $3))
           RETURNING id`,
          [phone, hashOtp(phone, code, deps.otpSecret), OTP_TTL_SEC],
        );
        return inserted.rows[0]!.id;
      });

      try {
        await deps.sms.send(phone, otpMessage(code));
      } catch (err) {
        // The code never arrived, so don't let it count towards the cooldown.
        await deps.db.query("DELETE FROM otp_codes WHERE id = $1", [otpId]);
        throw err;
      }
      return { sent: true, expiresInSec: OTP_TTL_SEC };
    });

    app.post("/verify", { config: { rateLimit } }, async (req) => {
      const body = verifyBody.parse(req.body);
      const phone = parsePhone(body.phone);

      const { rows } = await deps.db.query<{ id: string; code_hash: string; expired: boolean }>(
        `SELECT id, code_hash, expires_at <= now() AS expired
         FROM otp_codes
         WHERE phone = $1 AND consumed_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [phone],
      );
      const otp = rows[0];
      if (!otp) throw badRequest("otp_invalid", "That code is not correct");
      if (otp.expired) throw badRequest("otp_expired", "That code has expired. Request a new one.");

      // Count the attempt before checking the code, atomically, so parallel guesses can't exceed the limit.
      const attempt = await deps.db.query(
        "UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 AND attempts < $2 RETURNING id",
        [otp.id, OTP_MAX_ATTEMPTS],
      );
      if (attempt.rowCount === 0) {
        throw tooManyRequests("otp_locked", "Too many wrong attempts. Request a new code.");
      }
      if (!otpMatches(phone, body.code, otp.code_hash, deps.otpSecret)) {
        throw badRequest("otp_invalid", "That code is not correct");
      }

      const existing = await deps.db.query("SELECT 1 FROM users WHERE phone = $1", [phone]);
      if (existing.rowCount === 0 && !body.name) {
        throw badRequest("name_required", "Tell us your name to finish creating your account");
      }

      return withTransaction(deps.db, async (client) => {
        await lockPhone(client, phone);
        const consumed = await client.query(
          "UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id",
          [otp.id],
        );
        if (consumed.rowCount === 0) throw badRequest("otp_invalid", "That code has already been used");
        // Older codes sent to this phone can't be used once one has signed in.
        await client.query(
          "UPDATE otp_codes SET consumed_at = now() WHERE phone = $1 AND consumed_at IS NULL",
          [phone],
        );

        const found = await client.query<AuthUser>(
          "SELECT id, name, phone, role FROM users WHERE phone = $1",
          [phone],
        );
        let user = found.rows[0];
        const isNewUser = !user;
        if (!user) {
          // Checked above, but the user could have been deleted in between.
          if (!body.name) throw badRequest("name_required", "Tell us your name to finish creating your account");
          user = await createUser(client, { phone, name: body.name });
        }

        const { refreshTokenId: _, ...session } = await issueSession(client, user.id, deps.jwtSecret);
        return { ...session, user, isNewUser };
      });
    });

    app.post("/refresh", async (req) => {
      const { refreshToken } = refreshBody.parse(req.body);
      return rotateSession(deps.db, refreshToken, deps.jwtSecret);
    });

    app.post("/logout", async (req, reply) => {
      const { refreshToken } = refreshBody.parse(req.body);
      await revokeSession(deps.db, refreshToken);
      return reply.code(204).send();
    });
  };
}
