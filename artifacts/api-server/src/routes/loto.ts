import { Router, type IRouter } from "express";
import {
  db,
  lotoRecordsTable,
  lotoAttachmentsTable,
  lotoEventsTable,
  usersTable,
  projectsTable,
  type LotoChecklistSection,
} from "@workspace/db";
import { and, eq, or, desc, asc, gte, ilike } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSafetyAccess } from "../lib/safetyAccess";
import { syncUserFromClerk } from "../lib/userSync";
import { createNotification } from "./notifications";
import {
  CreateLotoBody,
  UpdateLotoBody,
  ActivateLotoBody,
  RequestLotoReleaseBody,
  ReviewLotoBody,
  AuthorizeLotoEnergizationBody,
  CloseLotoBody,
  AddLotoWorkLogBody,
  AddLotoAuditNoteBody,
  AddLotoAttachmentBody,
} from "@workspace/api-zod";
import type { LotoReleaseChecklist } from "@workspace/db";

const router: IRouter = Router();

type LotoRow = typeof lotoRecordsTable.$inferSelect;
type EventRow = typeof lotoEventsTable.$inferSelect;
type AttachmentRow = typeof lotoAttachmentsTable.$inferSelect;

// ── Canonical checklist ──────────────────────────────────────────────────────
// Titles are server-authoritative. A LOTO can only be activated once every one
// of these sections is marked complete.
const LOTO_CHECKLIST_SECTIONS: ReadonlyArray<{ key: string; title: string }> = [
  { key: "preparation", title: "Notification & Preparation" },
  { key: "shutdown", title: "Equipment Shutdown" },
  { key: "isolation", title: "Energy Isolation" },
  { key: "lockout", title: "Lock & Tag Application" },
  { key: "stored_energy", title: "Stored Energy Release & Dissipation" },
  { key: "verification", title: "Zero-Energy Verification (Try-Out)" },
];

function initialChecklist(): LotoChecklistSection[] {
  return LOTO_CHECKLIST_SECTIONS.map((s) => ({
    key: s.key,
    title: s.title,
    complete: false,
    notes: null,
  }));
}

/** Re-key caller-supplied checklist onto the canonical sections (titles fixed). */
function mergeChecklist(
  existing: LotoChecklistSection[],
  incoming: Array<{ key: string; complete: boolean; notes?: string | null }>,
): LotoChecklistSection[] {
  const incomingByKey = new Map(incoming.map((s) => [s.key, s]));
  const existingByKey = new Map(existing.map((s) => [s.key, s]));
  return LOTO_CHECKLIST_SECTIONS.map((s) => {
    const inc = incomingByKey.get(s.key);
    const prev = existingByKey.get(s.key);
    return {
      key: s.key,
      title: s.title,
      complete: inc ? inc.complete : prev?.complete ?? false,
      notes: inc ? inc.notes ?? null : prev?.notes ?? null,
    };
  });
}

function checklistComplete(checklist: LotoChecklistSection[]): boolean {
  const byKey = new Map(checklist.map((s) => [s.key, s]));
  return LOTO_CHECKLIST_SECTIONS.every((s) => byKey.get(s.key)?.complete === true);
}

// ── Attachment policy ────────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB
const OBJECT_PATH_RE = /^\/objects\/[a-z0-9/_-]+$/i;

// ── Serializers ──────────────────────────────────────────────────────────────
function serialize(r: LotoRow) {
  return {
    id: r.id,
    lotoNumber: r.lotoNumber,
    projectId: r.projectId,
    equipmentName: r.equipmentName,
    equipmentLocation: r.equipmentLocation,
    description: r.description,
    severity: r.severity,
    status: r.status,
    commanderId: r.commanderId,
    lockedOutById: r.lockedOutById,
    additionalPersonnel: (r.additionalPersonnel ?? []) as number[],
    checklist: (r.checklist ?? []) as LotoChecklistSection[],
    createdById: r.createdById,
    activatedAt: r.activatedAt ? r.activatedAt.toISOString() : null,
    releaseRequestedAt: r.releaseRequestedAt ? r.releaseRequestedAt.toISOString() : null,
    releaseRequestedById: r.releaseRequestedById,
    releaseChecklist: (r.releaseChecklist ?? null) as LotoReleaseChecklist | null,
    reviewDecision: r.reviewDecision,
    reviewComments: r.reviewComments,
    reviewedById: r.reviewedById,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    authorizedById: r.authorizedById,
    authorizedAt: r.authorizedAt ? r.authorizedAt.toISOString() : null,
    authorizationComments: r.authorizationComments,
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    closedById: r.closedById,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function serializeEvent(e: EventRow) {
  return {
    id: e.id,
    lotoId: e.lotoId,
    type: e.type,
    message: e.message,
    actorId: e.actorId,
    createdAt: e.createdAt.toISOString(),
  };
}

function serializeAttachment(a: AttachmentRow) {
  return {
    id: a.id,
    lotoId: a.lotoId,
    fileName: a.fileName,
    objectPath: a.objectPath,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    uploadedById: a.uploadedById,
    createdAt: a.createdAt.toISOString(),
  };
}

async function logEvent(
  lotoId: number,
  type: string,
  message: string | null,
  actorId: number | null,
): Promise<void> {
  await db.insert(lotoEventsTable).values({ lotoId, type, message, actorId });
}

function parseId(raw: string | string[]): number | null {
  const v = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  return Number.isNaN(v) ? null : v;
}

/** True when the given user id references an existing user (commander assignment). */
async function commanderExists(id: number): Promise<boolean> {
  const [row] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id));
  return !!row;
}

/**
 * Validate + de-duplicate a list of additional-personnel user ids. Returns the
 * cleaned list, or null if any id does not reference an existing user.
 */
async function sanitizePersonnel(ids: number[] | undefined | null): Promise<number[] | null> {
  if (!ids || ids.length === 0) return [];
  const unique = Array.from(new Set(ids));
  for (const id of unique) {
    if (!(await commanderExists(id))) return null;
  }
  return unique;
}

// ── Dashboard summary (literal route — declared before /loto/:lotoId) ─────────
router.get("/loto/dashboard-summary", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const rows = await db
    .select({
      status: lotoRecordsTable.status,
      severity: lotoRecordsTable.severity,
      closedAt: lotoRecordsTable.closedAt,
    })
    .from(lotoRecordsTable);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  let draft = 0,
    active = 0,
    pendingReview = 0,
    closedThisMonth = 0,
    criticalActive = 0;

  for (const r of rows) {
    if (r.status === "draft") draft += 1;
    else if (r.status === "active") active += 1;
    else if (r.status === "pending_review") pendingReview += 1;
    else if (r.status === "closed" && r.closedAt && r.closedAt >= monthStart) closedThisMonth += 1;

    if (r.severity === "critical" && (r.status === "active" || r.status === "pending_review")) {
      criticalActive += 1;
    }
  }

  res.json({ draft, active, pendingReview, closedThisMonth, criticalActive });
});

// ── List (company-wide visibility) ───────────────────────────────────────────
router.get("/loto", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const { status, projectId, severity, q } = req.query as Record<string, string | undefined>;

  const conditions = [];
  if (status && ["draft", "active", "pending_review", "closed"].includes(status)) {
    conditions.push(eq(lotoRecordsTable.status, status));
  }
  if (severity && ["low", "medium", "high", "critical"].includes(severity)) {
    conditions.push(eq(lotoRecordsTable.severity, severity));
  }
  if (projectId) {
    const pid = parseInt(projectId, 10);
    if (!Number.isNaN(pid)) conditions.push(eq(lotoRecordsTable.projectId, pid));
  }
  if (q && q.trim()) {
    conditions.push(ilike(lotoRecordsTable.equipmentName, `%${q.trim()}%`));
  }

  const rows = await db
    .select()
    .from(lotoRecordsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(lotoRecordsTable.createdAt));

  res.json(rows.map(serialize));
});

// ── Create (draft) ───────────────────────────────────────────────────────────
router.post("/loto", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireSafetyAccess(req, res);
  if (!user) return;

  const parsed = CreateLotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { projectId, equipmentName, equipmentLocation, description, severity, commanderId, lockedOutById, additionalPersonnel } = parsed.data;

  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(400).json({ error: "Linked project not found" });
    return;
  }

  if (commanderId != null && !(await commanderExists(commanderId))) {
    res.status(400).json({ error: "Assigned LOTO Commander not found" });
    return;
  }
  if (lockedOutById != null && !(await commanderExists(lockedOutById))) {
    res.status(400).json({ error: "Locked-out-by user not found" });
    return;
  }
  const personnel = await sanitizePersonnel(additionalPersonnel);
  if (personnel === null) {
    res.status(400).json({ error: "One or more additional personnel not found" });
    return;
  }

  const [created] = await db
    .insert(lotoRecordsTable)
    .values({
      lotoNumber: "",
      projectId,
      equipmentName,
      equipmentLocation: equipmentLocation ?? null,
      description: description ?? null,
      severity: severity ?? "medium",
      status: "draft",
      commanderId: commanderId ?? null,
      lockedOutById: lockedOutById ?? null,
      additionalPersonnel: personnel,
      checklist: initialChecklist(),
      createdById: user.id,
    })
    .returning();

  // Assign a human-facing number now that we have the serial id.
  const lotoNumber = `LOTO-${String(created.id).padStart(4, "0")}`;
  const [withNumber] = await db
    .update(lotoRecordsTable)
    .set({ lotoNumber })
    .where(eq(lotoRecordsTable.id, created.id))
    .returning();

  await logEvent(created.id, "created", `Draft created (${lotoNumber})`, user.id);

  res.status(201).json(serialize(withNumber));
});

// ── Get one ──────────────────────────────────────────────────────────────────
router.get("/loto/:lotoId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }
  const [row] = await db.select().from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }
  res.json(serialize(row));
});

// ── Update (draft only) ──────────────────────────────────────────────────────
router.patch("/loto/:lotoId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireSafetyAccess(req, res);
  if (!user) return;

  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }

  const parsed = UpdateLotoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }
  if (existing.status === "closed") {
    res.status(409).json({ error: "Closed LOTO records are immutable" });
    return;
  }

  const u = parsed.data;
  const isDraft = existing.status === "draft";

  // Personnel (commander, locked-out-by, additional personnel) may be edited
  // while draft OR active (the Work Phase). Core fields (equipment, location,
  // description, severity, checklist) are draft-only.
  const coreEdit =
    u.equipmentName !== undefined ||
    u.equipmentLocation !== undefined ||
    u.description !== undefined ||
    u.severity !== undefined ||
    u.checklist !== undefined;
  if (coreEdit && !isDraft) {
    res.status(409).json({ error: "Only draft LOTO records can edit equipment, severity, or the checklist" });
    return;
  }

  // SECURITY: commander/personnel reassignment is locked once a record enters
  // the commander-review cycle. The review/authorize/close gates key off the
  // current commanderId, so allowing reassignment during pending_review would
  // let a Safety user make themselves commander and then self-authorize/close.
  // Reassignment is only permitted while draft or active.
  const personnelEdit =
    u.commanderId !== undefined ||
    u.lockedOutById !== undefined ||
    u.additionalPersonnel !== undefined;
  if (personnelEdit && existing.status !== "draft" && existing.status !== "active") {
    res.status(409).json({ error: "Personnel cannot be reassigned once the LOTO is pending commander review" });
    return;
  }

  if (u.commanderId != null && !(await commanderExists(u.commanderId))) {
    res.status(400).json({ error: "Assigned LOTO Commander not found" });
    return;
  }
  if (u.lockedOutById != null && !(await commanderExists(u.lockedOutById))) {
    res.status(400).json({ error: "Locked-out-by user not found" });
    return;
  }
  let personnel: number[] | undefined;
  if (u.additionalPersonnel !== undefined) {
    const cleaned = await sanitizePersonnel(u.additionalPersonnel);
    if (cleaned === null) {
      res.status(400).json({ error: "One or more additional personnel not found" });
      return;
    }
    personnel = cleaned;
  }

  const setClause: Partial<typeof lotoRecordsTable.$inferInsert> = {
    ...(u.equipmentName !== undefined ? { equipmentName: u.equipmentName } : {}),
    ...(u.equipmentLocation !== undefined ? { equipmentLocation: u.equipmentLocation } : {}),
    ...(u.description !== undefined ? { description: u.description } : {}),
    ...(u.severity !== undefined ? { severity: u.severity } : {}),
    ...(u.commanderId !== undefined ? { commanderId: u.commanderId } : {}),
    ...(u.lockedOutById !== undefined ? { lockedOutById: u.lockedOutById } : {}),
    ...(personnel !== undefined ? { additionalPersonnel: personnel } : {}),
    ...(u.checklist !== undefined
      ? { checklist: mergeChecklist((existing.checklist ?? []) as LotoChecklistSection[], u.checklist) }
      : {}),
  };

  const [updated] = await db
    .update(lotoRecordsTable)
    .set(setClause)
    .where(eq(lotoRecordsTable.id, id))
    .returning();

  res.json(serialize(updated));
});

// ── Activate (draft → active) ────────────────────────────────────────────────
router.post("/loto/:lotoId/activate", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireSafetyAccess(req, res);
  if (!user) return;

  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }

  const parsed = ActivateLotoBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }
  if (existing.status !== "draft") {
    res.status(409).json({ error: "Only draft LOTO records can be activated" });
    return;
  }

  const commanderId = parsed.data.commanderId ?? existing.commanderId;
  if (commanderId == null) {
    res.status(409).json({ error: "A LOTO Commander must be assigned before activation" });
    return;
  }
  if (!(await commanderExists(commanderId))) {
    res.status(400).json({ error: "Assigned LOTO Commander not found" });
    return;
  }

  if (!checklistComplete((existing.checklist ?? []) as LotoChecklistSection[])) {
    res.status(409).json({ error: "All checklist sections must be complete before activation" });
    return;
  }

  const [updated] = await db
    .update(lotoRecordsTable)
    .set({ status: "active", commanderId, activatedAt: new Date() })
    .where(eq(lotoRecordsTable.id, id))
    .returning();

  await logEvent(id, "activated", "LOTO activated — energy isolated, work authorized", user.id);

  res.json(serialize(updated));
});

// ── Work-phase log (active only) — notes & issues during the work window ──────
router.post("/loto/:lotoId/work-log", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireSafetyAccess(req, res);
  if (!user) return;

  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }

  const parsed = AddLotoWorkLogBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select({ status: lotoRecordsTable.status }).from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }
  if (existing.status !== "active") {
    res.status(409).json({ error: "Work-phase notes can only be logged while the LOTO is active" });
    return;
  }

  const { kind, message } = parsed.data;
  const type = kind === "issue" ? "work_issue" : "work_note";
  const [event] = await db
    .insert(lotoEventsTable)
    .values({ lotoId: id, type, message, actorId: user.id })
    .returning();

  res.status(201).json(serializeEvent(event));
});

// ── Request release (active → pending_review) — stores the release checklist ──
router.post("/loto/:lotoId/request-release", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireSafetyAccess(req, res);
  if (!user) return;

  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }

  const parsed = RequestLotoReleaseBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }
  if (existing.status !== "active") {
    res.status(409).json({ error: "Only active LOTO records can request release" });
    return;
  }

  const { workComplete, toolsRemoved, guardsInstalled, areaCleaned, personnelClear, note } = parsed.data;
  if (!workComplete || !toolsRemoved || !guardsInstalled || !areaCleaned || !personnelClear) {
    res.status(409).json({ error: "All release-readiness checks must be confirmed before requesting release" });
    return;
  }

  const releaseChecklist: LotoReleaseChecklist = {
    workComplete,
    toolsRemoved,
    guardsInstalled,
    areaCleaned,
    personnelClear,
    note: note?.trim() || null,
  };

  const [updated] = await db
    .update(lotoRecordsTable)
    .set({
      status: "pending_review",
      releaseRequestedAt: new Date(),
      releaseRequestedById: user.id,
      releaseChecklist,
      // Clear any prior review outcome when re-submitting after a rejection so
      // the new review cycle starts clean (no stale review/authorization).
      reviewDecision: null,
      reviewComments: null,
      reviewedById: null,
      reviewedAt: null,
      authorizedById: null,
      authorizedAt: null,
      authorizationComments: null,
    })
    .where(eq(lotoRecordsTable.id, id))
    .returning();

  await logEvent(
    id,
    "release_requested",
    note?.trim() ? `Release requested: ${note.trim()}` : "Release requested — sent for commander review",
    user.id,
  );

  // Notify the assigned commander with LOTO#, project, equipment, requester.
  if (updated.commanderId) {
    const [project] = await db
      .select({ name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.id, updated.projectId));
    const message =
      `Release requested for ${updated.lotoNumber} — ` +
      `Project: ${project?.name ?? `#${updated.projectId}`} · ` +
      `Equipment: ${updated.equipmentName} · ` +
      `Requested by: ${user.name}`;
    await createNotification(
      updated.commanderId,
      null,
      "loto_release_request",
      message,
      `/safety?loto=${updated.id}`,
    );
  }

  res.json(serialize(updated));
});

// ── Commander review (pending_review → approved-in-place | active) ────────────
router.post("/loto/:lotoId/commander-review", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  // Per-record commander gate (or admin), NOT Safety department membership — an
  // assigned commander may live outside the Safety department and must still be
  // able to review their own records.
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }

  const parsed = ReviewLotoBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }
  if (existing.status !== "pending_review") {
    res.status(409).json({ error: "Only LOTO records pending commander review can be reviewed" });
    return;
  }
  // Each release cycle gets exactly one commander decision. Once a decision is
  // recorded (or energization already authorized), the cycle is locked; a new
  // decision requires a fresh request-release submission.
  if (existing.reviewDecision !== null || existing.authorizedAt !== null) {
    res.status(409).json({ error: "This release has already been reviewed; a new release request is required to review again" });
    return;
  }
  if (user.role !== "admin" && existing.commanderId !== user.id) {
    res.status(403).json({ error: "Only the assigned LOTO Commander or an admin may review this record" });
    return;
  }

  const { decision, comments } = parsed.data;
  const reviewComments = comments?.trim() || null;

  if (decision === "rejected") {
    // Return to the work phase; clear the prior release submission.
    const [updated] = await db
      .update(lotoRecordsTable)
      .set({
        status: "active",
        reviewDecision: "rejected",
        reviewComments,
        reviewedById: user.id,
        reviewedAt: new Date(),
        releaseRequestedAt: null,
        releaseRequestedById: null,
        releaseChecklist: null,
        // Defensive: a rejected cycle must never carry authorization forward.
        authorizedById: null,
        authorizedAt: null,
        authorizationComments: null,
      })
      .where(eq(lotoRecordsTable.id, id))
      .returning();

    await logEvent(
      id,
      "review_rejected",
      reviewComments ? `Review rejected: ${reviewComments}` : "Review rejected — returned to active",
      user.id,
    );
    res.json(serialize(updated));
    return;
  }

  // Approved: record the review but keep the record pending until energization
  // is explicitly authorized.
  const [updated] = await db
    .update(lotoRecordsTable)
    .set({
      reviewDecision: "approved",
      reviewComments,
      reviewedById: user.id,
      reviewedAt: new Date(),
    })
    .where(eq(lotoRecordsTable.id, id))
    .returning();

  await logEvent(
    id,
    "review_approved",
    reviewComments ? `Review approved: ${reviewComments}` : "Review approved — awaiting energization authorization",
    user.id,
  );

  res.json(serialize(updated));
});

// ── Authorize energization (approved review, still pending_review) ────────────
router.post("/loto/:lotoId/authorize-energization", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }

  const parsed = AuthorizeLotoEnergizationBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }
  if (existing.status !== "pending_review" || existing.reviewDecision !== "approved") {
    res.status(409).json({ error: "Energization can only be authorized after the commander review is approved" });
    return;
  }
  if (user.role !== "admin" && existing.commanderId !== user.id) {
    res.status(403).json({ error: "Only the assigned LOTO Commander or an admin may authorize energization" });
    return;
  }

  const comments = parsed.data.comments?.trim() || null;
  const [updated] = await db
    .update(lotoRecordsTable)
    .set({ authorizedById: user.id, authorizedAt: new Date(), authorizationComments: comments })
    .where(eq(lotoRecordsTable.id, id))
    .returning();

  await logEvent(
    id,
    "energization_authorized",
    comments ? `Energization authorized: ${comments}` : "Energization authorized — ready for close-out",
    user.id,
  );

  res.json(serialize(updated));
});

// ── Close (authorized → closed) — record becomes permanently immutable ───────
router.post("/loto/:lotoId/close", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }

  const parsed = CloseLotoBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }
  if (
    existing.status !== "pending_review" ||
    existing.reviewDecision !== "approved" ||
    existing.authorizedAt == null
  ) {
    res.status(409).json({ error: "Only a LOTO with an approved review and authorized energization can be closed" });
    return;
  }
  if (user.role !== "admin" && existing.commanderId !== user.id) {
    res.status(403).json({ error: "Only the assigned LOTO Commander or an admin may close this record" });
    return;
  }

  const [updated] = await db
    .update(lotoRecordsTable)
    .set({ status: "closed", closedAt: new Date(), closedById: user.id })
    .where(eq(lotoRecordsTable.id, id))
    .returning();

  const note = parsed.data.note?.trim();
  await logEvent(id, "closed", note ? `LOTO closed: ${note}` : "LOTO closed — record sealed", user.id);

  res.json(serialize(updated));
});

// ── Audit trail ──────────────────────────────────────────────────────────────
router.get("/loto/:lotoId/events", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }
  const rows = await db
    .select()
    .from(lotoEventsTable)
    .where(eq(lotoEventsTable.lotoId, id))
    .orderBy(asc(lotoEventsTable.createdAt));
  res.json(rows.map(serializeEvent));
});

// ── Admin audit note (permitted even on closed records) ──────────────────────
router.post("/loto/:lotoId/audit-notes", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Only an admin may add audit notes" });
    return;
  }

  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }

  const parsed = AddLotoAuditNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select({ id: lotoRecordsTable.id }).from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }

  const [event] = await db
    .insert(lotoEventsTable)
    .values({ lotoId: id, type: "audit_note", message: parsed.data.message, actorId: user.id })
    .returning();

  res.status(201).json(serializeEvent(event));
});

// ── Attachments ──────────────────────────────────────────────────────────────
router.get("/loto/:lotoId/attachments", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }
  const rows = await db
    .select()
    .from(lotoAttachmentsTable)
    .where(eq(lotoAttachmentsTable.lotoId, id))
    .orderBy(lotoAttachmentsTable.createdAt);
  res.json(rows.map(serializeAttachment));
});

router.post("/loto/:lotoId/attachments", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireSafetyAccess(req, res);
  if (!user) return;

  const id = parseId(req.params.lotoId);
  if (id === null) {
    res.status(400).json({ error: "Invalid LOTO ID" });
    return;
  }

  const parsed = AddLotoAttachmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { fileName, objectPath, fileSize, mimeType } = parsed.data;

  const [existing] = await db.select().from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }
  if (existing.status === "closed") {
    res.status(409).json({ error: "Closed LOTO records are immutable" });
    return;
  }

  if (!OBJECT_PATH_RE.test(objectPath)) {
    res.status(400).json({ error: "Invalid object path" });
    return;
  }
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    res.status(400).json({ error: "Unsupported file type. Allowed: images, PDF, and office documents." });
    return;
  }
  if (fileSize != null && fileSize > MAX_ATTACHMENT_BYTES) {
    res.status(400).json({ error: "File exceeds the 25 MB limit" });
    return;
  }

  const dupe = await db
    .select({ id: lotoAttachmentsTable.id })
    .from(lotoAttachmentsTable)
    .where(eq(lotoAttachmentsTable.objectPath, objectPath));
  if (dupe.length > 0) {
    res.status(409).json({ error: "Object already attached" });
    return;
  }

  const [attachment] = await db
    .insert(lotoAttachmentsTable)
    .values({
      lotoId: id,
      fileName,
      objectPath,
      fileSize: fileSize ?? null,
      mimeType: mimeType ?? null,
      uploadedById: user.id,
    })
    .returning();

  await logEvent(id, "attachment_added", `Attachment added: ${fileName}`, user.id);

  res.status(201).json(serializeAttachment(attachment));
});

router.delete("/loto/:lotoId/attachments/:attachmentId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireSafetyAccess(req, res);
  if (!user) return;

  const id = parseId(req.params.lotoId);
  const attachmentId = parseId(req.params.attachmentId);
  if (id === null || attachmentId === null) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [record] = await db.select().from(lotoRecordsTable).where(eq(lotoRecordsTable.id, id));
  if (!record) {
    res.status(404).json({ error: "LOTO record not found" });
    return;
  }
  if (record.status === "closed") {
    res.status(409).json({ error: "Closed LOTO records are immutable" });
    return;
  }

  const [attachment] = await db
    .select()
    .from(lotoAttachmentsTable)
    .where(and(eq(lotoAttachmentsTable.id, attachmentId), eq(lotoAttachmentsTable.lotoId, id)));
  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  if (user.role !== "admin" && attachment.uploadedById !== user.id) {
    res.status(403).json({ error: "Only the uploader or an admin may delete this attachment" });
    return;
  }

  await db
    .delete(lotoAttachmentsTable)
    .where(and(eq(lotoAttachmentsTable.id, attachmentId), eq(lotoAttachmentsTable.lotoId, id)));

  await logEvent(id, "attachment_removed", `Attachment removed: ${attachment.fileName}`, user.id);

  res.sendStatus(204);
});

// ── Project active-LOTO banner (company-wide, any authenticated user) ─────────
router.get("/projects/:projectId/active-loto", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const projectId = parseId(req.params.projectId);
  if (projectId === null) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const rows = await db
    .select({
      id: lotoRecordsTable.id,
      lotoNumber: lotoRecordsTable.lotoNumber,
      equipmentName: lotoRecordsTable.equipmentName,
      severity: lotoRecordsTable.severity,
      status: lotoRecordsTable.status,
      commanderId: lotoRecordsTable.commanderId,
    })
    .from(lotoRecordsTable)
    .where(
      and(
        eq(lotoRecordsTable.projectId, projectId),
        or(eq(lotoRecordsTable.status, "active"), eq(lotoRecordsTable.status, "pending_review")),
      ),
    )
    .orderBy(desc(lotoRecordsTable.activatedAt));

  res.json(rows);
});

export default router;
