# Refresh dev database from production

This document covers the **prod → dev** snapshot refresh. It is the only
supported way to populate the development database with realistic data.

## Direction is one-way, always

```
production (Neon, source of truth)  ──pg_dump──▶  development (Helium, disposable)
```

There is no reverse path. Nothing in this repository copies dev data into
prod. At publish time, **never** check the "Copy development database to
production database" box.

## Prerequisites (one-time)

You need a connection string for production. Get it from the Replit
**Database** pane after switching the environment toggle to **Production**.
Then add a workspace secret:

| Secret name                   | Value                                  |
| ----------------------------- | -------------------------------------- |
| `DATABASE_URL_PROD_READONLY`  | Production connection string from Replit |

Notes:

- The name is deliberately distinct from `DATABASE_URL` so application code
  cannot pick it up by accident. Only the refresh script reads it.
- Replit-managed Neon does not expose a separately-scoped read-only role,
  so this URL is technically a read/write credential. The refresh script
  only ever invokes `pg_dump` against it — pg_dump is a read-only
  operation. Do not use this secret for any other purpose.
- The secret stays in the workspace only. Do not copy it into the
  deployment, into any other secret, or into committed code.

## Running a refresh

Dry run (default — prints what would happen, makes no changes):

```bash
pnpm --filter @workspace/scripts run db:refresh-dev
```

Apply (mutates the dev database):

```bash
pnpm --filter @workspace/scripts run db:refresh-dev -- --yes
```

The script prints prod row counts (tasks, users) before the dump and dev
row counts after the restore. The two should match. If they do not, the
script exits non-zero and tells you exactly which counts disagreed.

Expected runtime on the current database size (~300 tasks, ~15 users,
~10 MiB dump) is well under 60 seconds.

## What the refresh does

In order:

1. **Hostname guard.** Verifies that `DATABASE_URL_PROD_READONLY` looks
   like a Neon host and that `DATABASE_URL` does **not**. Aborts otherwise.
2. **Identity probe.** Connects to each URL with `psql` and runs
   `SELECT current_database()`. The prod URL must report `neondb`; the
   dev URL must not. This catches misconfigurations the hostname guard
   would miss (proxies, custom domains, copy-paste swaps).
3. Reads prod task/user counts via `psql -Atqc` (read-only `SELECT`,
   counted as a prod operation alongside `pg_dump`).
4. `pg_dump --format=custom --no-owner --no-privileges` of prod into a
   temp file.
5. `pg_restore --clean --if-exists --no-owner` into dev. **Not
   transactional** — a mid-restore failure leaves dev in a partially
   restored state. Re-run the script; it is idempotent because of
   `--clean --if-exists`. Do not try to use dev between a failed run
   and a successful re-run.
6. Applies the data-handling policy:
   - **`notifications`** — copies the table verbatim from prod, then
     deletes anything older than **7 days**. The script computes a
     single cutoff timestamp in JS (`Date.now() - 7d`, ISO string) and
     reuses it for both the `DELETE FROM notifications WHERE created_at
     < TIMESTAMPTZ '<cutoff>'` and the verification query, so rows at
     the boundary cannot slip between two `NOW()` calls. The cutoff is
     logged at the start of the policy pass. Both Inbox-style
     rows (`sender_id IS NULL`) and Sent / general rows (`sender_id IS
     NOT NULL`, `broadcast_id` set) within the window are preserved —
     the cut-off is purely time-based, not type-based. The 7-day window
     is a constant in `scripts/src/refresh-dev-db.ts`
     (`POLICY.notificationRetentionDays`); change it there if you ever
     need a different window. After the prune the script verifies that
     zero rows older than the window remain and aborts otherwise.
   - **`task_attachments` / `project_attachments`** — installs a
     `BEFORE DELETE` trigger that raises an exception. Dev cannot delete
     attachment rows because those rows point at real production files in
     the shared object-storage bucket. Cascading deletes from parents
     (e.g. deleting a project) will also fail with the same error; that is
     intentional. Drop the trigger manually if you need to override.
     Note: a future `drizzle-kit push` that recreates an attachment table
     will drop the trigger with it; re-run the refresh to reinstall.
7. Prints dev row counts and exits. Row-count mismatches abort with a
   non-zero exit and a detailed message (partial restore vs. live writes
   during the dump window vs. workflow writes after restore).

## After a refresh: restart the api-server workflow

A `pg_restore --clean` rewrites every primary key the API server has ever
seen. Restart the `artifacts/api-server: API Server` workflow once the
refresh completes so any in-memory state (open connections, request-scoped
caches, anything a future helper might memoize) repopulates from the new
DB. Skipping this step has previously caused 404s on real projects whose
post-refresh IDs collided with pre-refresh sentinel IDs that a module-scope
cache was still holding.

All operations against prod are read-only (`SELECT count(*)` and
`pg_dump`). All destructive operations target dev only.

The temp dump file lives under the system tmpdir and is removed on exit.

## What the refresh does **not** do

- It does not touch production. Prod operations are read-only: an
  identity probe (`SELECT current_database()`), task/user row counts
  (`SELECT count(*)`), and `pg_dump`.
- It does not modify `DATABASE_URL` or any other secret.
- It does not wipe dev notifications. Recent notifications (last 7
  days) are copied from prod so the Inbox and Sent tabs look realistic;
  only older rows are pruned.
- It does not change schema. It assumes dev and prod schemas already
  match (which they do via the publish-time diff). If you have unpushed
  schema changes in dev, **they will be lost** — push them to prod first
  or stash them before refreshing.
- It does not change the object-storage bucket. Dev and prod continue to
  share storage.
- It does not sign you in. Copied user rows include real prod Clerk IDs,
  but those tokens do not validate against the dev Clerk tenant. Sign in
  fresh after a refresh; your dev sign-in will reuse the matching row if
  the email matches, or create a new row otherwise.

## Rollback

The script writes only to dev. To "roll back" a bad refresh, just refresh
again — `pg_restore --clean --if-exists` is idempotent. If the dev DB is
corrupt enough that even a re-restore fails, reprovision a fresh Helium
DB through Replit's Database pane and re-run the refresh.

The original pre-cutover Helium DB is no longer preserved as a separate
backup target; we explicitly traded that for simplicity. Reprovision +
refresh is the recovery path.

## When to refresh

There is no schedule. Refresh manually before:

- Investigating a production-only bug you cannot reproduce against the
  current dev data.
- Verifying a UI change against realistic row counts and edge cases.
- Cutting a noticeable backend behavior change.

Refreshing without a reason is fine — it is fast and safe — but it does
wipe any test data you have set up in dev. Be deliberate.

## Failure modes

| Symptom                                                           | Meaning / Fix                                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL_PROD_READONLY is not set`                           | Add the secret per "Prerequisites" above.                                                                                  |
| `cross-wiring guard tripped: ... does not look like a Neon host`  | The prod secret value is wrong. Re-copy the prod URL from Replit's Database pane.                                          |
| `cross-wiring guard tripped: DATABASE_URL host ... looks like Neon` | Your workspace `DATABASE_URL` got pointed at prod. Restore it to the Helium dev URL before doing anything else.            |
| `pg_dump exited with status N`                                    | Prod URL is unreachable or credentials are wrong. Test with `psql "$DATABASE_URL_PROD_READONLY" -c 'select 1'`.            |
| `row count mismatch after restore`                                | `pg_restore` partially failed. Re-run; the script is idempotent. If the second run also fails, capture the log and report. |
| `Attachment deletion is disabled in dev` while using the app      | Working as designed (see policy step 5). Drop the trigger manually if you need to remove an attachment row in dev.         |
