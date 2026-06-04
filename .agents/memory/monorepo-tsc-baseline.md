---
name: monorepo tsc baseline
description: Why full `tsc`/`tsc --build` is red on main in this monorepo, and how to actually verify type-correctness of changed files.
---

The repo's `pnpm run typecheck` / `tsc --build` does NOT pass cleanly on main. Treat a red full-typecheck as the pre-existing baseline, not your regression. Verify only your changed files.

**Pre-existing failures (not yours):**
- `lib/api-zod` `export *` from both `generated/api` and `generated/types` produces TS2308 "already exported a member" ambiguities (CreateTaskBody, UpdateLotoBody, etc.). With `noEmitOnError: true` this blocks `lib/api-zod` declaration emit.
- Because api-server consumes libs via TS **project references**, a failed lib emit cascades: api-server `tsc --noEmit` then reports missing exports (e.g. loto.ts CreateLotoBody) and missing db tables — these are stale/un-emitted declarations, not real missing code.
- Web (`artifacts/tacot3`) `tsc` fails immediately: referenced project `lib/object-storage-web` lacks `composite: true`.
- `routes/inventory.ts` (string|string[] params) and `routes/tasks.ts:484` status comparison are pre-existing red.

**Why the app still runs:** workspace packages resolve to **src** at runtime, not dist. `package.json` `exports` point at `./src/index.ts` and `tsconfig.base.json` sets `customConditions: ["workspace"]`. Dev runs via tsx (api-server) and vite/esbuild (web), which ignore type-only diagnostics. So new exports in `lib/api-zod`/`lib/db` src are available immediately without rebuilding dist.

**How to verify YOUR changes:**
- Rebuild lib declarations first: `pnpm run typecheck:libs` (== `tsc --build`). `lib/db` emits fine; `lib/api-zod` will still fail on the pre-existing ambiguity.
- For a changed web file, write a temp tsconfig that extends `tsconfig.base.json` and drops the `references` array, then `tsc -p tsconfig.verify.json --noEmit` and grep for your filename. Clean grep = your file is type-correct.
