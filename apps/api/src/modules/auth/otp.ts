import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL_SEC = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SEC = 60;
export const OTP_MAX_PER_HOUR = 5;

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Bound to the phone so a hash can't be reused for another number. */
export function hashOtp(phone: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");
}

export function otpMatches(phone: string, code: string, storedHash: string, secret: string): boolean {
  const candidate = Buffer.from(hashOtp(phone, code, secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function otpMessage(code: string): string {
  return `Your Dispatch code is ${code}. It expires in ${OTP_TTL_SEC / 60} minutes. Don't share it with anyone.`;
}
