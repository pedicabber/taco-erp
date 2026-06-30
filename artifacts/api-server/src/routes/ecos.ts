import { Router, type IRouter } from "express";
import {
  db,
  projectsTable,
  engineeringChangeOrdersTable,
  ecoAttachmentsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, max } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { syncUserFromClerk } from "../lib/userSync";
import { rejectIfHiddenProject } from "../lib/officeAdmin";
import { centsToDollars, dollarsToCents, parseMoneyToCents } from "../lib/money";
import { resolveSchedule } from "../lib/schedule";
import {
  CreateEcoBody,
  UpdateEcoBody,
  ListEcosResponse,
  GetEcoResponse,
  GetEcoSummaryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const OBJECT_PATH_RE = /^\/objects\/[a-z0-9/_-]+$/i;

type EcoRow = typeof engineeringChangeOrdersTable.$inferSelect;
type EcoAttachmentRow = typeof ecoAttachmentsTable.$inferSelect;

function buildEcoAttachment(a: EcoAttachmentRow) {
  return {
    id: a.id,
    ecoId: a.ecoId,
    projectId: a.projectId,
    fileName: a.fileName,
    objectPath: a.objectPath,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    uploadedById: a.uploadedById,
    createdAt: a.createdAt.toISOString(),
  };
}

function buildEco(e: EcoRow, attachments: EcoAttachmentRow[]) {
  return {
    id: e.id,
    projectId: e.projectId,
    seq: e.seq,
    ecoNumber: e.ecoNumber,
    title: e.title,
    description: e.description,
    ecoType: e.ecoType as
      | "customer_request"
      | "internal_improvement"
      | "correction"
      | "scope_addition"
      | "scope_reduction",
    costImpact: centsToDollars(e.costImpactCents) ?? 0,
    leadTimeImpactDays: e.leadTimeImpactDays,
    customerApproved: e.customerApproved as "yes" | "no" | "pending",
    status: e.status as "draft" | "approved" | "implemented" | "cancelled" | "rejected",
    approvalDate: e.approvalDate,
    createdById: e.createdById,
    lastModifiedById: e.lastModifiedById,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    attachments: attachments.map(buildEcoAttachment),
  };
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

// Approved ECOs are the ones whose cost/schedule impacts count toward the
// current contract value and delivery. Implemented ECOs are also realized.
const REALIZED_STATUSES = new Set(["approved", "implemented"]);

// ── Summary ──────────────────────────────────────────────────────────────────

router.get("/projects/:projectId/eco-summary", requireAuth, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  if (await rejectIfHiddenProject(res, projectId)) return;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const ecos = await db
    .select()
    .from(engineeringChangeOrdersTable)
    .where(eq(engineeringChangeOrdersTable.projectId, projectId));

  let approvedCount = 0;
  let pendingCount = 0;
  let realizedCostCents = 0;
  let realizedScheduleDays = 0;
  for (const e of ecos) {
    if (e.status === "approved") approvedCount += 1;
    if (e.status === "draft") pendingCount += 1;
    if (REALIZED_STATUSES.has(e.status)) {
      realizedCostCents += e.costImpactCents;
      realizedScheduleDays += e.leadTimeImpactDays;
    }
  }

  const originalCents =
    project.originalContractValueCents ?? parseMoneyToCents(project.totalPrice);
  const currentCents = originalCents === null ? null : originalCents + realizedCostCents;

  // Same resolver as the project Schedule card so Original/Current Delivery
  // match exactly between the ECO summary and the project overview.
  const resolved = resolveSchedule(project);
  const originalDelivery = resolved.baselineDeliveryDate;
  const currentDelivery = resolved.activeDeliveryDate;

  res.json(
    GetEcoSummaryResponse.parse({
      approvedCount,
      pendingCount,
      totalCount: ecos.length,
      originalContractValue: centsToDollars(originalCents),
      currentContractValue: centsToDollars(currentCents),
      originalDelivery,
      currentDelivery,
      totalCostImpact: centsToDollars(realizedCostCents) ?? 0,
      totalScheduleImpactDays: realizedScheduleDays,
    }),
  );
});

// ── List ─────────────────────────────────────────────────────────────────────

router.get("/projects/:projectId/ecos", requireAuth, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  if (await rejectIfHiddenProject(res, projectId)) return;

  const conditions = [eq(engineeringChangeOrdersTable.projectId, projectId)];

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && ["draft", "approved", "implemented", "cancelled", "rejected"].includes(status)) {
    conditions.push(eq(engineeringChangeOrdersTable.status, status));
  }
  const customerApproved =
    typeof req.query.customerApproved === "string" ? req.query.customerApproved : undefined;
  if (customerApproved && ["yes", "no", "pending"].includes(customerApproved)) {
    conditions.push(eq(engineeringChangeOrdersTable.customerApproved, customerApproved));
  }
  const fromDate = typeof req.query.fromDate === "string" ? req.query.fromDate : undefined;
  if (fromDate) conditions.push(gte(engineeringChangeOrdersTable.createdAt, new Date(fromDate)));
  const toDate = typeof req.query.toDate === "string" ? req.query.toDate : undefined;
  if (toDate) {
    // Inclusive end-of-day for a date-only filter.
    const end = new Date(toDate);
    end.setUTCHours(23, 59, 59, 999);
    conditions.push(lte(engineeringChangeOrdersTable.createdAt, end));
  }

  const ecos = await db
    .select()
    .from(engineeringChangeOrdersTable)
    .where(and(...conditions))
    .orderBy(desc(engineeringChangeOrdersTable.seq));

  const attachments =
    ecos.length === 0
      ? []
      : await db
          .select()
          .from(ecoAttachmentsTable)
          .where(eq(ecoAttachmentsTable.projectId, projectId));
  const byEco = new Map<number, EcoAttachmentRow[]>();
  for (const a of attachments) {
    if (!byEco.has(a.ecoId)) byEco.set(a.ecoId, []);
    byEco.get(a.ecoId)!.push(a);
  }

  res.json(ListEcosResponse.parse(ecos.map((e) => buildEco(e, byEco.get(e.id) ?? []))));
});

// ── Create ───────────────────────────────────────────────────────────────────

router.post("/projects/:projectId/ecos", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  if (await rejectIfHiddenProject(res, projectId)) return;

  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const parsed = CreateEcoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const status = parsed.data.status ?? "draft";
  const approvalDate = status === "approved" ? todayDateOnly() : null;

  // Derive the per-project sequence as max(seq)+1. A UNIQUE(project_id, seq)
  // constraint guarantees correctness under concurrency: if two requests race
  // for the same seq, one insert hits a 23505 and we retry with a fresh max.
  let eco: EcoRow | undefined;
  for (let attempt = 0; attempt < 5 && !eco; attempt++) {
    const [{ value: maxSeq } = { value: null }] = await db
      .select({ value: max(engineeringChangeOrdersTable.seq) })
      .from(engineeringChangeOrdersTable)
      .where(eq(engineeringChangeOrdersTable.projectId, projectId));
    const seq = (maxSeq ?? 0) + 1;
    const ecoNumber = `ECO-${String(seq).padStart(3, "0")}`;

    try {
      [eco] = await db
        .insert(engineeringChangeOrdersTable)
        .values({
          projectId,
          seq,
          ecoNumber,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          ecoType: parsed.data.ecoType ?? "customer_request",
          costImpactCents: dollarsToCents(parsed.data.costImpact) ?? 0,
          leadTimeImpactDays: parsed.data.leadTimeImpactDays ?? 0,
          customerApproved: parsed.data.customerApproved ?? "pending",
          status,
          approvalDate,
          createdById: user.id,
          lastModifiedById: user.id,
        })
        .returning();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") continue; // unique violation — retry with new seq
      throw err;
    }
  }

  if (!eco) {
    res.status(409).json({ error: "Could not allocate ECO number, please retry" });
    return;
  }

  res.status(201).json(GetEcoResponse.parse(buildEco(eco, [])));
});

// ── Get one ──────────────────────────────────────────────────────────────────

router.get("/projects/:projectId/ecos/:ecoId", requireAuth, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  const ecoId = parseInt(req.params.ecoId, 10);
  if (isNaN(projectId) || isNaN(ecoId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  if (await rejectIfHiddenProject(res, projectId)) return;

  const [eco] = await db
    .select()
    .from(engineeringChangeOrdersTable)
    .where(and(eq(engineeringChangeOrdersTable.id, ecoId), eq(engineeringChangeOrdersTable.projectId, projectId)));
  if (!eco) { res.status(404).json({ error: "ECO not found" }); return; }

  const attachments = await db
    .select()
    .from(ecoAttachmentsTable)
    .where(eq(ecoAttachmentsTable.ecoId, ecoId));

  res.json(GetEcoResponse.parse(buildEco(eco, attachments)));
});

// ── Update ───────────────────────────────────────────────────────────────────

router.patch("/projects/:projectId/ecos/:ecoId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const projectId = parseInt(req.params.projectId, 10);
  const ecoId = parseInt(req.params.ecoId, 10);
  if (isNaN(projectId) || isNaN(ecoId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  if (await rejectIfHiddenProject(res, projectId)) return;

  const [existing] = await db
    .select()
    .from(engineeringChangeOrdersTable)
    .where(and(eq(engineeringChangeOrdersTable.id, ecoId), eq(engineeringChangeOrdersTable.projectId, projectId)));
  if (!existing) { res.status(404).json({ error: "ECO not found" }); return; }

  const parsed = UpdateEcoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const patch: Partial<typeof engineeringChangeOrdersTable.$inferInsert> = {
    lastModifiedById: user.id,
  };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description ?? null;
  if (parsed.data.ecoType !== undefined) patch.ecoType = parsed.data.ecoType;
  if (parsed.data.costImpact !== undefined) patch.costImpactCents = dollarsToCents(parsed.data.costImpact) ?? 0;
  if (parsed.data.leadTimeImpactDays !== undefined) patch.leadTimeImpactDays = parsed.data.leadTimeImpactDays;
  if (parsed.data.customerApproved !== undefined) patch.customerApproved = parsed.data.customerApproved;
  if (parsed.data.status !== undefined) {
    patch.status = parsed.data.status;
    // Stamp the approval date when transitioning into approved (and it wasn't
    // already set); clear it when leaving approved back to a non-approved state.
    if (parsed.data.status === "approved" && !existing.approvalDate) {
      patch.approvalDate = todayDateOnly();
    } else if (parsed.data.status !== "approved" && parsed.data.status !== "implemented") {
      patch.approvalDate = null;
    }
  }

  const [updated] = await db
    .update(engineeringChangeOrdersTable)
    .set(patch)
    .where(and(eq(engineeringChangeOrdersTable.id, ecoId), eq(engineeringChangeOrdersTable.projectId, projectId)))
    .returning();

  const attachments = await db
    .select()
    .from(ecoAttachmentsTable)
    .where(eq(ecoAttachmentsTable.ecoId, ecoId));

  res.json(GetEcoResponse.parse(buildEco(updated, attachments)));
});

// ── Attachments ──────────────────────────────────────────────────────────────

router.post("/projects/:projectId/ecos/:ecoId/attachments", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const projectId = parseInt(req.params.projectId, 10);
  const ecoId = parseInt(req.params.ecoId, 10);
  if (isNaN(projectId) || isNaN(ecoId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  if (await rejectIfHiddenProject(res, projectId)) return;

  const [eco] = await db
    .select({ id: engineeringChangeOrdersTable.id })
    .from(engineeringChangeOrdersTable)
    .where(and(eq(engineeringChangeOrdersTable.id, ecoId), eq(engineeringChangeOrdersTable.projectId, projectId)));
  if (!eco) { res.status(404).json({ error: "ECO not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const fileName = typeof body.fileName === "string" ? body.fileName : null;
  const objectPath = typeof body.objectPath === "string" ? body.objectPath : null;
  if (!fileName || !objectPath) { res.status(400).json({ error: "Invalid attachment body" }); return; }
  if (!OBJECT_PATH_RE.test(objectPath)) { res.status(400).json({ error: "Invalid object path" }); return; }

  const existing = await db
    .select({ id: ecoAttachmentsTable.id })
    .from(ecoAttachmentsTable)
    .where(eq(ecoAttachmentsTable.objectPath, objectPath));
  if (existing.length > 0) { res.status(409).json({ error: "Object already attached" }); return; }

  const [attachment] = await db
    .insert(ecoAttachmentsTable)
    .values({
      ecoId,
      projectId,
      fileName,
      objectPath,
      fileSize: typeof body.fileSize === "number" ? body.fileSize : null,
      mimeType: typeof body.mimeType === "string" ? body.mimeType : null,
      uploadedById: user.id,
    })
    .returning();

  res.status(201).json(buildEcoAttachment(attachment));
});

router.delete("/projects/:projectId/ecos/:ecoId/attachments/:attachmentId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  const ecoId = parseInt(req.params.ecoId, 10);
  const attachmentId = parseInt(req.params.attachmentId, 10);
  if (isNaN(projectId) || isNaN(ecoId) || isNaN(attachmentId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  if (await rejectIfHiddenProject(res, projectId)) return;

  const clerkId = req.userId;
  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [dbUser] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  if (!dbUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [attachment] = await db
    .select({ uploadedById: ecoAttachmentsTable.uploadedById })
    .from(ecoAttachmentsTable)
    .where(and(eq(ecoAttachmentsTable.id, attachmentId), eq(ecoAttachmentsTable.ecoId, ecoId)));
  if (!attachment) { res.status(404).json({ error: "Attachment not found" }); return; }

  if (dbUser.role !== "admin" && attachment.uploadedById !== dbUser.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  await db
    .delete(ecoAttachmentsTable)
    .where(and(eq(ecoAttachmentsTable.id, attachmentId), eq(ecoAttachmentsTable.ecoId, ecoId)));
  res.sendStatus(204);
});

export default router;
