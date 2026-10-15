import type { FileStorage } from "./adapters/storage.js";
import type { SmsSender } from "./adapters/sms.js";
import type { Db } from "./db/pool.js";

/** Everything the app needs from the outside world, passed in so tests can swap fakes. */
export interface AppDeps {
  db: Db;
  sms: SmsSender;
  storage: FileStorage;
  jwtSecret: string;
  otpSecret: string;
  /** Per-IP limit on /auth/otp and /auth/verify. Defaults to 20 an hour. */
  authRateLimitPerHour?: number;
}
