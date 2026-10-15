/**
 * Creates (or promotes) a Suvakta super admin.
 *
 *   pnpm admin:create --mobile 98xxxxxxxx --name "Your Name" [--env production|staging|local]
 *
 * - If the mobile already has an account, it is promoted (its password is unchanged).
 * - Otherwise a new login is created; the password is asked for at a hidden prompt
 *   (or read from SUPER_ADMIN_PASSWORD) so it never appears in shell history.
 */
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { hashPassword } from "../src/server/auth/password";
import { newId } from "../src/lib/ids";
import { normalizeMobile } from "../src/lib/text";

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? ""]] : acc), []),
);
const env = (args.env ?? "local") as "local" | "staging" | "production";
const DB = { local: "dukaanos-dev", staging: "dukaanos-staging", production: "dukaanos-prod" }[env];
const mobile = normalizeMobile(args.mobile ?? "");
if (!mobile || !DB) {
  console.error('Usage: pnpm admin:create --mobile 98xxxxxxxx --name "Your Name" [--env production|staging|local]');
  process.exit(1);
}

function d1(sql: string): string {
  const where = env === "local" ? ["--local"] : ["--remote", "--env", env];
  return execFileSync("npx", ["wrangler", "d1", "execute", DB!, ...where, "--json", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => {
      if (s.includes(question)) out.output.write(s);
    };
    rl.question(question, (a) => {
      rl.close();
      process.stdout.write("\n");
      resolve(a);
    });
  });
}

const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  const found = JSON.parse(d1(`SELECT id, name FROM users WHERE mobile = ${sq(mobile!)}`)) as Array<{ results: Array<{ id: string; name: string }> }>;
  const existing = found[0]?.results[0];
  if (existing) {
    d1(`UPDATE users SET platform_role = 'SUPER_ADMIN', updated_at = ${Date.now()} WHERE id = ${sq(existing.id)}`);
    console.log(`✓ ${existing.name} (+91 ${mobile}) is now a super admin on ${env}. Log in and open /admin.`);
    return;
  }
  const name = (args.name ?? "").trim();
  if (name.length < 2) throw new Error("--name is required when creating a new login.");
  const password = process.env.SUPER_ADMIN_PASSWORD ?? (await ask("New password (min 8 chars): "));
  if (password.length < 8) throw new Error("Password must have at least 8 characters.");
  const now = Date.now();
  d1(
    `INSERT INTO users (id, name, mobile, password_hash, is_active, platform_role, created_at, updated_at) VALUES (${sq(newId(now))}, ${sq(name)}, ${sq(mobile!)}, ${sq(await hashPassword(password))}, 1, 'SUPER_ADMIN', ${now}, ${now})`,
  );
  console.log(`✓ Created super admin ${name} (+91 ${mobile}) on ${env}. Log in with that mobile and open /admin.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
