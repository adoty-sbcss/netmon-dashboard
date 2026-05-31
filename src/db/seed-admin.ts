/**
 * Seed (or reset) the local break-glass admin account.
 *
 *   npm run auth:seed              # create if missing (idempotent, safe to re-run)
 *   npm run auth:seed -- --reset   # also reset an EXISTING admin to the default
 *
 * Creates user "adaministrator" with password "password" and forces a change on
 * first login. The hash format MUST match src/lib/auth/password.ts (scrypt).
 * Kept dependency-free + raw-SQL so it runs under tsx without the Next runtime.
 */
import "dotenv/config";
import postgres from "postgres";
import { randomBytes, scryptSync } from "node:crypto";

const ADMIN_USERNAME = "adaministrator";
const DEFAULT_PASSWORD = "password";

function hashPassword(pw: string): string {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function main() {
  const reset = process.argv.includes("--reset");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  const existing = await sql<{ id: number }[]>`
    SELECT id FROM users WHERE email = ${ADMIN_USERNAME} LIMIT 1`;

  if (existing.length && !reset) {
    console.log(
      `Admin "${ADMIN_USERNAME}" already exists (id=${existing[0].id}); no change. Use --reset to restore the default password.`,
    );
    await sql.end();
    return;
  }

  const passwordHash = hashPassword(DEFAULT_PASSWORD);

  if (existing.length) {
    await sql`
      UPDATE users SET
        password_hash = ${passwordHash},
        must_change_password = true,
        is_break_glass = true,
        role = 'superadmin',
        disabled = false
      WHERE email = ${ADMIN_USERNAME}`;
    console.log(`Reset admin "${ADMIN_USERNAME}" to the default password.`);
  } else {
    await sql`
      INSERT INTO users
        (email, display_name, role, is_break_glass, password_hash, must_change_password, disabled)
      VALUES
        (${ADMIN_USERNAME}, 'Administrator', 'superadmin', true, ${passwordHash}, true, false)`;
    console.log(`Created admin "${ADMIN_USERNAME}".`);
  }

  await sql`
    INSERT INTO audit_log (actor_type, actor, action, detail)
    VALUES ('system', 'seed-admin', ${reset ? "admin_reset" : "admin_seeded"}, '{}'::jsonb)`;

  console.log(
    `\n  Username: ${ADMIN_USERNAME}\n  Password: ${DEFAULT_PASSWORD}  (must be changed on first login)\n`,
  );
  await sql.end();
}

main().catch((err) => {
  console.error("seed-admin failed:", err);
  process.exit(1);
});
