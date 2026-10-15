// Route guards: check the bearer token, load the user, and enforce roles.
// The role is read from the database on each request, so a change (e.g. customer → rider)
// takes effect immediately without waiting for a new token.

import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { UserRole } from "@dispatch/shared";
import type { AppDeps } from "../deps.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";
import { forbidden, unauthorized } from "./errors.js";

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export type Guard = (...roles: UserRole[]) => preHandlerAsyncHookHandler;

export function makeGuard(deps: Pick<AppDeps, "db" | "jwtSecret">): Guard {
  return (...roles) =>
    async function guard(req) {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        throw unauthorized("unauthorized", "Missing access token");
      }

      let userId: string;
      try {
        userId = await verifyAccessToken(header.slice("Bearer ".length), deps.jwtSecret);
      } catch {
        throw unauthorized("invalid_token", "Access token is invalid or expired");
      }

      const { rows } = await deps.db.query<AuthUser>(
        "SELECT id, name, phone, role FROM users WHERE id = $1",
        [userId],
      );
      const user = rows[0];
      if (!user) throw unauthorized("invalid_token", "Access token is invalid or expired");
      if (roles.length > 0 && !roles.includes(user.role)) {
        throw forbidden("forbidden", "You don't have access to this");
      }
      req.user = user;
    };
}

/** The signed-in user. Only call in routes that use a guard. */
export function currentUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized("unauthorized", "Missing access token");
  return req.user;
}
