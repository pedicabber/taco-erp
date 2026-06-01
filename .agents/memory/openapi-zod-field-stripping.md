---
name: OpenAPI/orval zod strips unknown keys
description: Why adding a DB/model field is not enough — it must be added to the OpenAPI schemas or it silently vanishes in both directions.
---

In this monorepo, request validation and response serialization both go through
orval-generated zod schemas in `@workspace/api-zod` (generated from
`lib/api-spec/openapi.yaml`). The generated schemas use plain `z.object()` with
**no `.passthrough()`**, so zod silently strips any key not declared in the schema.

**Consequence:** a field can exist in the Drizzle table, the DB row, and the
server handler, yet still be dropped:
- On **write** (POST/PATCH): keys missing from `CreateProjectBody`/`UpdateProjectBody`
  are stripped from `parsed.data`, so edits never reach the DB.
- On **read** (GET/list): keys missing from the response schema (e.g. `Project`)
  are stripped from the JSON, so the frontend never sees them (the tell-tale sign
  was `(project as any)` casts in the React code to access "missing" fields).

**Why:** orval emits no `.passthrough()`, and zod's default object behavior is strip.

**How to apply:** whenever you add a field to a model, you MUST add it to ALL
relevant OpenAPI schemas — the response schema AND every request body that should
accept it — then run `pnpm --filter @workspace/api-spec run codegen`. After codegen,
**restart the api-server workflow**: its dev command bundles the zod at startup, so a
running server keeps the old (stripping) validation until restarted. Handlers that
spread `...parsed.data` then pick up new fields automatically.
