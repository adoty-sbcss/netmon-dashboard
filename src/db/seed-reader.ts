/**
 * Seed (or update) the global READ-ONLY dashboard account.
 *
 *   READER_EMAIL=netmon-reader READER_PASSWORD='<strong-password>' npm run seed:reader
 *
 * Creates a LOCAL password login with role 'user' + a GLOBAL grant: it sees every
 * district (read), but cannot perform any privileged action — config push, remote
 * console, host actions, data resets, SNMP edits, VLAN apply, provisioning are ALL
 * superadmin-gated, and this account is NOT superadmin. Intended for validation /
 * auditing (incl. agent-driven read-only browsing).
 *
 * The password is read from the environment so it never lands in code, git, or logs
 * — set it yourself when you run the job. Idempotent: re-running resets the password
 * + ensures the global grant. Hash format MUST match src/lib/auth/password.ts (scrypt).
 * Raw-SQL + dependency-free so it runs under tsx without the Next runtime.
 */
import "dotenv/config";
import postgres from "postgres";
import { randomBytes, scryptSync } from "node:crypto";

const EMAIL = (process.env.READER_EMAIL || "netmon-reader").trim().toLowerCase();
const PASSWORD = process.env.READER_PASSWORD ?? "";

function hashPassword(pw: string): string {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function main() {
  if (PASSWORD.length < 12) {
    console.error(
      "READER_PASSWORD must be set and at least 12 characters. Refusing to create a weak/passwordless reader account.",
    );
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const passwordHash = hashPassword(PASSWORD);

  const existing = await sql<{ id: number }[]>`
    SELECT id FROM users WHERE email = ${EMAIL} LIMIT 1`;

  let userId: number;
  if (existing.length) {
    userId = existing[0].id;
    await sql`
      UPDATE users SET
        password_hash = ${passwordHash},
        must_change_password = false,
        is_break_glass = false,
        role = 'viewer',
        disabled = false
      WHERE id = ${userId}`;
    console.log(`Updated reader "${EMAIL}" (id=${userId}): password reset, role=viewer.`);
  } else {
    const inserted = await sql<{ id: number }[]>`
      INSERT INTO users
        (email, display_name, role, is_break_glass, password_hash, must_change_password, disabled)
      VALUES
        (${EMAIL}, 'NetMon Reader (read-only)', 'viewer', false, ${passwordHash}, false, false)
      RETURNING id`;
    userId = inserted[0].id;
    console.log(`Created reader "${EMAIL}" (id=${userId}).`);
  }

  // Global grant = sees every district (read). scope_id is null for 'global'. The
  // unique index treats NULL scope_id as distinct, so check-then-insert for idempotency.
  const grant = await sql<{ id: number }[]>`
    SELECT id FROM grants WHERE user_id = ${userId} AND scope_type = 'global' LIMIT 1`;
  if (grant.length === 0) {
    await sql`INSERT INTO grants (user_id, scope_type, scope_id) VALUES (${userId}, 'global', NULL)`;
    console.log("Added global (all-districts) read grant.");
  } else {
    console.log("Global grant already present.");
  }

  await sql`
    INSERT INTO audit_log (actor_type, actor, action, detail)
    VALUES ('system', 'seed-reader', 'reader_seeded', ${sql.json({ email: EMAIL, role: "user", scope: "global", readOnly: true })})`;

  console.log(
    `\n  Read-only account ready.\n  Username: ${EMAIL}\n  Authority: role=viewer + global grant — reads every district; ALL mutations blocked by the read-only middleware. Manage/reset it from Settings → Users.\n`,
  );
  await sql.end();
}

main().catch((err) => {
  console.error("seed-reader failed:", err);
  process.exit(1);
});
