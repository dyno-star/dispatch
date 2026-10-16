import type { UserRole } from "@dispatch/shared";
import type { DbClient } from "../../db/pool.js";
import type { AuthUser } from "../../http/auth-guard.js";

/** Creates a user with their own personal account. Call inside a transaction. */
export async function createUser(
  client: DbClient,
  input: { phone: string; name: string; role?: UserRole },
): Promise<AuthUser> {
  const { rows: accounts } = await client.query<{ id: string }>(
    "INSERT INTO accounts (type, name) VALUES ('personal', $1) RETURNING id",
    [input.name],
  );
  const accountId = accounts[0]!.id;
  const { rows: users } = await client.query<AuthUser>(
    `INSERT INTO users (account_id, phone, name, role) VALUES ($1, $2, $3, $4)
     RETURNING id, name, phone, role`,
    [accountId, input.phone, input.name, input.role ?? "customer"],
  );
  const user = users[0]!;
  await client.query("UPDATE accounts SET owner_user_id = $1 WHERE id = $2", [user.id, accountId]);
  return user;
}

/** Serialises OTP sends and sign-ups for one phone number until the transaction ends. */
export async function lockPhone(client: DbClient, phone: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('phone:' || $1))", [phone]);
}
