// Reads configuration from environment variables. See .env.example.

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  env: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL", "postgres://dispatch:dispatch@localhost:5433/dispatch"),
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
} as const;
