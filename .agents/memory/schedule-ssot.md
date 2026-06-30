---
name: Schedule single source of truth
description: How project schedule dates (baseline/active/legacy) are normalized and where the one resolver lives.
---

# Schedule single source of truth

Project schedule dates have ONE server-side resolver: `resolveSchedule()` in
`artifacts/api-server/src/lib/schedule.ts`. Every backend consumer that exposes
schedule dates (project GET/list builder, ECO summary, SQDC late-project) calls it.

Rule:
- `active*  = active ?? legacy`
- `baseline* = baseline ?? active`  (i.e. baseline ?? active ?? legacy)
- `scheduleDriftDays` is **recomputed from the resolved delivery dates**; the
  stored column is only a fallback when a date is unparseable.
- `baseline_*` = frozen original; `active_*` = current working schedule; legacy
  `start_date`/`delivery_date` are migration/self-heal INPUTS only — never a
  normal UI source of truth.

**Why:** screens used to each re-implement their own legacy fallback, so the same
project showed different baseline/active/drift values (e.g. Overview baseline blank
while ECO summary showed a date). Centralizing prevents that drift.

**How to apply:** any new code that needs a project's schedule must call
`resolveSchedule()` (backend) or read the normalized `schedule.*` object the API
returns (frontend). Do not read raw `*_date` columns or the flat legacy
`startDate`/`deliveryDate` fields as a schedule source. Write paths (create / PATCH
/ reschedule) keep their own baseline-freeze logic — they only seed baseline when
null, from the pre-edit/pre-move committed value, never from the new entry.
