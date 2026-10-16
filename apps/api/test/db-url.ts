// Tests use their own database on the docker compose Postgres (pnpm db:up).
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://dispatch:dispatch@localhost:5433/dispatch_test";
