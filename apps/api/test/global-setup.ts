// Runs once before all test files: creates dispatch_test if missing, wipes it and applies migrations.

import pg from "pg";
import { runMigrations } from "../src/db/migrate.js";
import { TEST_DATABASE_URL } from "./db-url.js";

export default async function setup(): Promise<void> {
  const testDb = new URL(TEST_DATABASE_URL);
  const dbName = testDb.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`Can't reach Postgres at ${adminUrl.host}. Start it with \`pnpm db:up\`.`, { cause: err });
  }
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await runMigrations(client, () => {});
  } finally {
    await client.end();
  }
}
