---
name: Storage object read authorization
description: How the api-server decides whether to serve a private object, and what breaks when adding a new attachment type.
---

# Storage object read authorization

`GET /storage/objects/*` in the api-server does NOT use a blanket `requireAuth`
middleware. Instead it authorizes per-object by looking the object path up in
specific attachment tables (project attachments, task attachments, avatars,
loading-media, LOTO attachments). If an object path is not found in any of those
lookups, the route returns **404** — even though the file uploaded fine.

**Why:** access policy differs per attachment kind (some public, some
owner/admin-only, some company-wide-authenticated). The route encodes each
policy inline rather than via one middleware.

**How to apply:** when you add a NEW kind of attachment (new table + upload
flow), you MUST also add a lookup branch in this read route, or downloads/previews
will silently 404. Decide the read policy explicitly:
- public/no-auth (e.g. loading-media is auth-gated but content-agnostic),
- owner-or-admin (task attachments),
- company-wide = any authenticated internal user (LOTO attachments: served only
  after a `getAuth(req)?.userId` check, never anonymously).
