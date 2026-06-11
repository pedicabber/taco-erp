---
name: Schedule baseline freeze
description: Rules for projects.baseline_start_date/baseline_delivery_date immutability
---

`projects.baseline_start_date` / `baseline_delivery_date` are the FROZEN original
schedule commitment. `active_*` dates move on reschedule/edit; baseline must NOT.
Drift (schedule_drift_days) = active_delivery - baseline_delivery.

**Rule:** Never overwrite a baseline column once set. The ONLY allowed write is
null-initialization, and it must seed from the project's PRE-edit / PRE-move
committed value (existing.active_* ?? legacy start/delivery) — never from the new
value the user just submitted. Reschedule re-asserts baseline = existing ?? oldActive
?? legacy (no-op when set, seeds legacy nulls).

**Why:** A prior bug made baseline appear to track active and collapse drift to 0.
Cause: lib/db uses `drizzle-kit push` with NO migration backfill, so every project
created before the baseline columns existed has NULL baseline. UI and the ECO
summary read `baseline ?? deliveryDate`, and reschedule overwrites the legacy
`deliveryDate` with the new active value — so the fallback resolved to the moved
date. A secondary defect seeded null baseline from the newly-edited value.

**How to apply:** When adding any code path that edits project dates, route active
changes only; leave baseline untouched unless null, then seed from the prior
committed value. After any schema add of frozen columns via push, run a one-time
idempotent backfill (see lib/db/scripts/backfill-baseline.mjs) in EVERY environment
(dev AND prod) — push does not backfill existing rows.
