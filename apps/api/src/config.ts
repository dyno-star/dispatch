// Reads configuration from environment variables. See .env.example.

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const env = process.env.NODE_ENV ?? "development";

/** Secrets have a fallback for local development only; production must set them. */
function secret(name: string, devFallback: string): string {
  return required(name, env === "production" ? undefined : devFallback);
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  env,
  databaseUrl: required("DATABASE_URL", "postgres://dispatch:dispatch@localhost:5433/dispatch"),
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
  jwtSecret: secret("JWT_SECRET", "dev-jwt-secret-do-not-use-in-production"),
  otpSecret: secret("OTP_SECRET", "dev-otp-secret-do-not-use-in-production"),
  uploadDir: required("UPLOAD_DIR", "./.data/uploads"),
  cityConfigPath: required("CITY_CONFIG", "./config/cities/lagos.json"),
} as const;
