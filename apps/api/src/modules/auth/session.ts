// Issuing and rotating login sessions (access + refresh token pairs).

import { randomUUID } from "node:crypto";
import type { Db, DbClient } from "../../db/pool.js";
import { withTransaction } from "../../db/pool.js";
import { unauthorized } from "../../http/errors.js";
import {
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_DAYS,
  hashToken,
  newRefreshToken,
  signAccessToken,
} from "./tokens.js";

export interface Session {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

interface IssuedSession extends Session {
  refreshTokenId: string;
}

/** Creates a new session. Pass familyId to continue an existing login (refresh). */
export async function issueSession(
  client: DbClient,
  userId: string,
  jwtSecret: string,
  familyId: string = randomUUID(),
): Promise<IssuedSession> {
  const refreshToken = newRefreshToken();
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))
     RETURNING id`,
    [userId, familyId, hashToken(refreshToken), REFRESH_TOKEN_TTL_DAYS],
  );
  return {
    accessToken: await signAccessToken(userId, jwtSecret),
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SEC,
    refreshToken,
    refreshTokenId: rows[0]!.id,
  };
}

/**
 * Swaps a refresh token for a new session. The old token is revoked.
 * Presenting an already-revoked token means it was copied, so the whole family is revoked.
 */
export async function rotateSession(db: Db, refreshToken: string, jwtSecret: string): Promise<Session> {
  const outcome = await withTransaction(db, async (client) => {
    const { rows } = await client.query<{
      id: string;
      user_id: string;
      family_id: string;
      expired: boolean;
      revoked: boolean;
    }>(
      `SELECT id, user_id, family_id, expires_at <= now() AS expired, revoked_at IS NOT NULL AS revoked
       FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(refreshToken)],
    );
    const row = rows[0];
    if (!row) return { kind: "invalid" as const };

    if (row.revoked) {
      await client.query(
        "UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL",
        [row.family_id],
      );
      return { kind: "reused" as const };
    }
    if (row.expired) return { kind: "expired" as const };

    const session = await issueSession(client, row.user_id, jwtSecret, row.family_id);
    await client.query("UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1", [
      row.id,
      session.refreshTokenId,
    ]);
    return { kind: "ok" as const, session };
  });

  // Thrown after the transaction commits so a family revocation sticks.
  switch (outcome.kind) {
    case "invalid":
      throw unauthorized("invalid_refresh_token", "Refresh token not recognised");
    case "reused":
      throw unauthorized("refresh_token_reused", "This session was signed out for safety. Please log in again.");
    case "expired":
      throw unauthorized("refresh_token_expired", "Session expired. Please log in again.");
    case "ok": {
      const { refreshTokenId: _, ...session } = outcome.session;
      return session;
    }
  }
}

/** Signs out the whole login the token belongs to. Unknown tokens are ignored. */
export async function revokeSession(db: Db, refreshToken: string): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE revoked_at IS NULL
       AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
    [hashToken(refreshToken)],
  );
}
