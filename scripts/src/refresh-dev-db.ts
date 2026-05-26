/**
 * scripts/src/refresh-dev-db.ts
 *
 * One-way prod -> dev snapshot refresh. Reads from prod with pg_dump,
 * restores into dev with pg_restore --clean --if-exists, then applies a
 * fixed data-handling policy (truncate notifications, install attachment
 * read-only triggers).
 *
 * Run with --yes to actually mutate dev. Without --yes, prints a dry-run
 * summary and exits 0.
 *
 * Safety guarantees (in order they execute):
 *   1. Refuses if either DATABASE_URL or DATABASE_URL_PROD_READONLY is missing.
 *   2. Cross-wiring guard: dev URL host MUST NOT contain "neon"; prod URL
 *      host MUST contain "neon". The script aborts before any I/O if these
 *      do not hold.
 *   3. Only pg_dump (read-only) is ever invoked against the prod URL.
 *      pg_restore and psql writes only ever run against the dev URL.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run db:refresh-dev          # dry run
 *   pnpm --filter @workspace/scripts run db:refresh-dev -- --yes # apply
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const APPLY = process.argv.includes("--yes");

const PROD_URL = process.env.DATABASE_URL_PROD_READONLY;
const DEV_URL = process.env.DATABASE_URL;

function die(msg: string): never {
  console.error(`\nrefresh-dev-db: ${msg}\n`);
  process.exit(1);
}

function parseConn(url: string, label: string): URL {
  try {
    return new URL(url);
  } catch {
    die(`could not parse the ${label} connection URL (value is malformed; not echoing it to avoid leaking secrets)`);
  }
}

function hostOf(url: string, label: string): string {
  return parseConn(url, label).host.toLowerCase();
}

/**
 * Build a libpq env block from a connection URL so we can invoke psql /
 * pg_dump / pg_restore WITHOUT passing the URL as a CLI argument. CLI args
 * are visible to anyone who can read /proc/<pid>/cmdline; env is not.
 */
function connEnv(url: string, label: string): NodeJS.ProcessEnv {
  const u = parseConn(url, label);
  const env: NodeJS.ProcessEnv = {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, "") || "postgres",
  };
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

if (!PROD_URL) {
  die(
    "DATABASE_URL_PROD_READONLY is not set.\n" +
      "Set it once via the Replit Secrets pane to the production database connection string.\n" +
      "See docs/refresh-dev-db.md for the exact procedure.",
  );
}
if (!DEV_URL) {
  die("DATABASE_URL is not set. The dev database is not provisioned in this workspace.");
}

const prodHost = hostOf(PROD_URL, "DATABASE_URL_PROD_READONLY");
const devHost = hostOf(DEV_URL, "DATABASE_URL");

if (!prodHost.includes("neon")) {
  die(
    `cross-wiring guard tripped: DATABASE_URL_PROD_READONLY host "${prodHost}" does not look like a Neon host.\n` +
      `Production is on Neon. Refusing to read from a non-Neon URL labeled as prod.`,
  );
}
if (devHost.includes("neon")) {
  die(
    `cross-wiring guard tripped: DATABASE_URL host "${devHost}" looks like a Neon host.\n` +
      `This script writes destructively to the dev DB. Refusing to point at Neon.`,
  );
}

console.log(`refresh-dev-db: prod host = ${prodHost}`);
console.log(`refresh-dev-db: dev  host = ${devHost}`);
console.log(`refresh-dev-db: mode     = ${APPLY ? "APPLY (--yes)" : "DRY RUN (no --yes)"}`);

const POLICY = {
  truncateTables: ["notifications"],
  readOnlyAttachmentTables: ["task_attachments", "project_attachments"],
} as const;

const POST_RESTORE_SQL = `
-- Refresh-dev-db policy pass. Idempotent; safe to re-run.

-- (1) Truncate tables the dev environment should not inherit.
TRUNCATE TABLE ${POLICY.truncateTables.join(", ")} RESTART IDENTITY CASCADE;

-- (2) Install BEFORE DELETE triggers on attachment tables so dev cannot
--     delete rows that point at real production object-storage files.
CREATE OR REPLACE FUNCTION dev_block_attachment_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Attachment deletion is disabled in dev (refresh-dev-db trigger). '
                  'Drop the trigger explicitly to override.';
END;
$$ LANGUAGE plpgsql;

${POLICY.readOnlyAttachmentTables
  .map(
    (t) => `DROP TRIGGER IF EXISTS dev_block_delete ON ${t};
CREATE TRIGGER dev_block_delete BEFORE DELETE ON ${t}
  FOR EACH ROW EXECUTE FUNCTION dev_block_attachment_delete();`,
  )
  .join("\n")}
`;

if (!APPLY) {
  console.log("\nrefresh-dev-db: DRY RUN. Would execute the following steps:");
  console.log("  1. pg_dump (custom format) from prod -> temp file");
  console.log(`  2. pg_restore --clean --if-exists into dev (${devHost})`);
  console.log(`  3. Truncate dev tables: ${POLICY.truncateTables.join(", ")}`);
  console.log(
    `  4. Install BEFORE DELETE triggers on: ${POLICY.readOnlyAttachmentTables.join(", ")}`,
  );
  console.log("  5. Print row counts");
  console.log("\nRe-run with --yes to apply.\n");
  process.exit(0);
}

/**
 * Run a subcommand against a specific connection. The URL is passed via
 * libpq env vars (PGHOST/PGUSER/PGPASSWORD/...) so it never appears in
 * argv. The echoed command line therefore contains no secrets at all.
 */
function run(
  cmd: string,
  args: string[],
  connUrl: string,
  connLabel: string,
): void {
  const printable = args.map((a) => (a.includes(" ") ? `"${a}"` : a));
  console.log(`\n$ ${cmd} ${printable.join(" ")}  # connection via ${connLabel} env`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...connEnv(connUrl, connLabel) },
  });
  if (r.status !== 0) {
    die(`${cmd} exited with status ${r.status ?? "signal " + r.signal}`);
  }
}

function psqlScalar(url: string, label: string, sql: string): string {
  const r = spawnSync("psql", ["-Atqc", sql], {
    encoding: "utf8",
    env: { ...process.env, ...connEnv(url, label) },
  });
  if (r.status !== 0) {
    die(`psql failed (${r.status}): ${r.stderr}`);
  }
  return r.stdout.trim();
}

const tmpDir = mkdtempSync(path.join(tmpdir(), "refresh-dev-db-"));
const dumpFile = path.join(tmpDir, "prod.dump");

try {
  // ---------- Step 0: identity probe (defense-in-depth over the hostname guard) ----------
  // Hostname substring matching alone is a convention check, not identity
  // verification. Confirm by asking each endpoint what database it is.
  const prodDb = psqlScalar(PROD_URL, "DATABASE_URL_PROD_READONLY", "SELECT current_database()");
  const devDb = psqlScalar(DEV_URL, "DATABASE_URL", "SELECT current_database()");
  console.log(`refresh-dev-db: prod current_database() = ${prodDb}`);
  console.log(`refresh-dev-db: dev  current_database() = ${devDb}`);
  if (prodDb !== "neondb") {
    die(
      `identity probe failed: DATABASE_URL_PROD_READONLY reports current_database() = "${prodDb}", expected "neondb". Refusing to dump from an unexpected database.`,
    );
  }
  if (devDb === "neondb") {
    die(
      `identity probe failed: DATABASE_URL reports current_database() = "neondb". Dev DB must not be the production database. Aborting before any destructive operation.`,
    );
  }

  // ---------- Step 1: prod row counts (read-only) ----------
  const prodTaskCount = psqlScalar(PROD_URL, "DATABASE_URL_PROD_READONLY", "SELECT count(*) FROM tasks");
  const prodUserCount = psqlScalar(PROD_URL, "DATABASE_URL_PROD_READONLY", "SELECT count(*) FROM users");
  console.log(`\nrefresh-dev-db: prod task count = ${prodTaskCount}, user count = ${prodUserCount}`);

  // ---------- Step 2: pg_dump from prod ----------
  // --no-owner / --no-privileges / --no-acl so the dump can restore into a
  // database owned by a different role. --format=custom to enable parallel
  // restore and clean drops.
  run(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges", "--no-acl", "--file", dumpFile],
    PROD_URL,
    "DATABASE_URL_PROD_READONLY",
  );
  const dumpSize = statSync(dumpFile).size;
  console.log(`refresh-dev-db: dump size = ${(dumpSize / 1024 / 1024).toFixed(1)} MiB`);

  // ---------- Step 3: pg_restore into dev ----------
  // --clean drops existing objects before recreating (with --if-exists to
  // avoid errors on first run). --no-owner is required because dev DB owner
  // differs from prod.
  run(
    "pg_restore",
    [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--no-acl",
      "--dbname",
      // libpq env supplies host/user/password; --dbname here only names the
      // target DB and is also already in PGDATABASE. Passing it explicitly
      // keeps pg_restore happy in single-db mode.
      connEnv(DEV_URL, "DATABASE_URL").PGDATABASE!,
      dumpFile,
    ],
    DEV_URL,
    "DATABASE_URL",
  );

  // ---------- Step 4: data-handling policy pass ----------
  const r = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-c", POST_RESTORE_SQL], {
    stdio: "inherit",
    env: { ...process.env, ...connEnv(DEV_URL, "DATABASE_URL") },
  });
  if (r.status !== 0) die(`policy SQL pass failed (${r.status})`);

  // ---------- Step 5: dev row counts ----------
  const devTaskCount = psqlScalar(DEV_URL, "DATABASE_URL", "SELECT count(*) FROM tasks");
  const devUserCount = psqlScalar(DEV_URL, "DATABASE_URL", "SELECT count(*) FROM users");
  const devNotifCount = psqlScalar(DEV_URL, "DATABASE_URL", "SELECT count(*) FROM notifications");
  console.log(
    `\nrefresh-dev-db: dev  task count = ${devTaskCount}, user count = ${devUserCount}, notifications = ${devNotifCount}`,
  );

  if (devTaskCount !== prodTaskCount || devUserCount !== prodUserCount) {
    die(
      `row count mismatch after restore (prod tasks=${prodTaskCount}/users=${prodUserCount} vs dev tasks=${devTaskCount}/users=${devUserCount}). ` +
        `Likely causes: (a) pg_restore partially failed mid-way — re-run, it is idempotent; (b) prod was written during the dump window (real users were active); (c) dev was written after restore by a running workflow. Investigate before trusting this dev DB.`,
    );
  }
  if (devNotifCount !== "0") {
    die(`notifications were not truncated (count=${devNotifCount}). Aborting as policy violation.`);
  }

  console.log("\nrefresh-dev-db: SUCCESS");
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
