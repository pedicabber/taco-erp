---
name: Project contract value consistency
description: currentContractValue must be computed identically across all project-returning endpoints
---

A project's `currentContractValue` = frozen `originalContractValueCents` + sum of
realized (status approved|implemented) ECO `costImpactCents`. This is NOT stored on
the project row; it is computed at response time in `buildProject(project, realizedCents)`.

**Rule:** every endpoint that returns a project (or list of projects) must pass the
realized ECO cents. Use `getRealizedEcoCents(projectId)` for single and
`getRealizedEcoCentsByProject(ids)` (batched) for lists — both in
`artifacts/api-server/src/routes/projects.ts`. Endpoints to keep in sync: GET /projects,
GET /projects/:id, PATCH /projects/:id, POST /projects/:id/reschedule.

**Why:** a prior review failed because only the single-project GET applied realized
cents; list/patch/reschedule returned original-only, so the same project showed
different contract values depending on which view loaded it.

**How to apply:** when adding any new project-returning route, call the helper and
pass the result into buildProject — never default realizedCents to 0 silently for a
real project response.
