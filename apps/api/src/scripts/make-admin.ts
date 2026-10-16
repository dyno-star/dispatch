// Creates an admin user, or promotes an existing user to admin.
// Usage: pnpm --filter @dispatch/api make-admin <phone> <name>

import { maskPhone, normalizeNigerianPhone } from "@dispatch/shared";
import { config } from "../config.js";
import { createPool, withTransaction } from "../db/pool.js";
import { createUser, lockPhone } from "../modules/users/users.js";

async function main(): Promise<void> {
  const [rawPhone, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();
  if (!rawPhone || !name) {
    console.error("Usage: pnpm --filter @dispatch/api make-admin <phone> <name>");
    process.exit(1);
  }
  const phone = normalizeNigerianPhone(rawPhone);
  if (!phone) {
    console.error(`Not a valid Nigerian mobile number: ${rawPhone}`);
    process.exit(1);
  }

  const db = createPool(config.databaseUrl);
  try {
    const created = await withTransaction(db, async (client) => {
      await lockPhone(client, phone);
      const promoted = await client.query("UPDATE users SET role = 'admin' WHERE phone = $1", [phone]);
      if (promoted.rowCount) return false;
      await createUser(client, { phone, name, role: "admin" });
      return true;
    });
    console.log(`${created ? "Created" : "Promoted"} admin ${maskPhone(phone)}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
