---
name: LOTO lifecycle cycle guards
description: Multi-step approval lifecycles must enforce per-cycle state guards server-side, not rely on UI hiding buttons.
---

The LOTO release lifecycle is `active → request-release → pending_review → commander-review (approve/reject) → authorize-energization → close`. A reject returns the record to `active`.

**Rule:** Every transition endpoint must validate the full predecessor state, and any transition that restarts a cycle (reject, re-request-release) must clear ALL downstream fields (review decision/comments + authorization who/when/comments), not just the immediate one.

**Why:** A prior bug let `commander-review` run on an already-approved/authorized record (it only checked `status === pending_review`). Reject then left stale `authorizedAt` set; a fresh request-release didn't clear it either; `close` only checked `status + authorizedAt`, so a record could close without a fresh authorization in the new cycle. Hiding buttons in the React UI does NOT prevent direct API calls from driving these invalid transitions.

**How to apply:** For any staged approval workflow — guard each endpoint with the exact required state (e.g. commander-review requires `reviewDecision === null && authorizedAt === null`; close requires `reviewDecision === "approved" && authorizedAt != null`), and on any backward/restart transition reset every field the later stages wrote.
