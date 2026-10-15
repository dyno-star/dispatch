// Access tokens: short-lived JWTs (HS256) carrying only the user id.
// Refresh tokens: opaque random strings; only their SHA-256 hash is stored.

import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "dispatch-api";
export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
    .sign(key(secret));
}

/** Returns the user id, or throws if the token is invalid or expired. */
export async function verifyAccessToken(token: string, secret: string): Promise<string> {
  const { payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, algorithms: ["HS256"] });
  if (!payload.sub) throw new Error("Token has no subject");
  return payload.sub;
}

export function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
