import { Router, type IRouter } from "express";
import { db, officeOpsTasksTable } from "@workspace/db";
import { and, eq, lt, or, isNull, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireOfficeOpsAccess } from "../lib/officeOpsAccess";
import {
  CreateOfficeOpsTaskBody,
  UpdateOfficeOpsTaskBody,
  ListOfficeOpsTasksQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

type OfficeOpsRow = typeof officeOpsTasksTable.$inferSelect;

function serialize(t: OfficeOpsRow) {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status as "open" | "completed",
    assigneeId: t.assigneeId,
    createdById: t.createdById,
    dueDate: t.dueDate,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    recurrence: t.recurrence as "none" | "daily" | "weekly" | "monthly",
    recurrenceAnchorDate: t.recurrenceAnchorDate,
    parentRecurrenceId: t.parentRecurrenceId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Today as YYYY-MM-DD in UTC. dueDate is a calendar date, no timezone. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Add `n` units to a YYYY-MM-DD string and return YYYY-MM-DD. */
function addToDate(dateStr: string, recurrence: "daily" | "weekly" | "monthly"): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (recurrence === "daily") dt.setUTCDate(dt.getUTCDate() + 1);
  else if (recurrence === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else dt.setUTCMonth(dt.getUTCMonth() + 1);
  return dt.toISOString().slice(0, 10);
}

function parseTaskId(raw: string | string[]): number | null {
  const v = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  return Number.isNaN(v) ? null : v;
}

router.get("/office-ops/tasks", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireOfficeOpsAccess(req, res);
  if (!user) return;

  const parsedQuery = ListOfficeOpsTasksQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }
  const { filter, scope } = parsedQuery.data;

  const conditions = [] as Array<ReturnType<typeof eq>>;

  if (filter === "open") {
    conditions.push(eq(officeOpsTasksTable.status, "open"));
  } else if (filter === "completed") {
    conditions.push(eq(officeOpsTasksTable.status, "completed"));
  } else {
    // overdue
    conditions.push(eq(officeOpsTasksTable.status, "open"));
    conditions.push(lt(officeOpsTasksTable.dueDate, todayUtc()));
  }

  if (scope === "mine") {
    const mineCondition = or(
      eq(officeOpsTasksTable.assigneeId, user.id),
      isNull(officeOpsTasksTable.assigneeId),
      eq(officeOpsTasksTable.createdById, user.id),
    );
    if (mineCondition) conditions.push(mineCondition as ReturnType<typeof eq>);
  }

  const rows = await db
    .select()
    .from(officeOpsTasksTable)
    .where(and(...conditions))
    .orderBy(desc(officeOpsTasksTable.createdAt));

  res.json(rows.map(serialize));
});

router.post("/office-ops/tasks", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireOfficeOpsAccess(req, res);
  if (!user) return;

  const parsed = CreateOfficeOpsTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { title, notes, assigneeId, dueDate, recurrence } = parsed.data;

  const [created] = await db
    .insert(officeOpsTasksTable)
    .values({
      title,
      notes: notes ?? null,
      status: "open",
      assigneeId: assigneeId ?? null,
      createdById: user.id,
      dueDate: dueDate ?? null,
      recurrence: recurrence ?? "none",
      recurrenceAnchorDate: recurrence && recurrence !== "none" ? (dueDate ?? null) : null,
      parentRecurrenceId: null,
    })
    .returning();

  res.status(201).json(serialize(created));
});

router.get("/office-ops/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireOfficeOpsAccess(req, res);
  if (!user) return;

  const id = parseTaskId(req.params.taskId);
  if (id === null) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }
  const [row] = await db.select().from(officeOpsTasksTable).where(eq(officeOpsTasksTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Office Ops task not found" });
    return;
  }
  res.json(serialize(row));
});

router.patch("/office-ops/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireOfficeOpsAccess(req, res);
  if (!user) return;

  const id = parseTaskId(req.params.taskId);
  if (id === null) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const parsed = UpdateOfficeOpsTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(officeOpsTasksTable).where(eq(officeOpsTasksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Office Ops task not found" });
    return;
  }

  // Per product decision #2 "all access-holders can create/assign", any user
  // who passed `requireOfficeOpsAccess` is allowed to edit/complete. Delete
  // remains admin-only (handled in the DELETE handler below).

  const updates = parsed.data;
  const willComplete = updates.status === "completed" && existing.status !== "completed";
  const reopening = updates.status === "open" && existing.status === "completed";

  const setClause = {
    ...(updates.title !== undefined ? { title: updates.title } : {}),
    ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
    ...(updates.status !== undefined ? { status: updates.status } : {}),
    ...(updates.assigneeId !== undefined ? { assigneeId: updates.assigneeId } : {}),
    ...(updates.dueDate !== undefined ? { dueDate: updates.dueDate } : {}),
    ...(updates.recurrence !== undefined ? { recurrence: updates.recurrence } : {}),
    ...(willComplete ? { completedAt: new Date() } : {}),
    ...(reopening ? { completedAt: null } : {}),
  };

  // Race guard: when completing, scope the UPDATE to rows still in "open"
  // status. Two concurrent completion PATCHes will both pass the `select`
  // above, but only one UPDATE returns a row — the loser's `returning()` is
  // empty and we skip rollover, preventing duplicate next-instance inserts.
  const whereClause = willComplete
    ? and(eq(officeOpsTasksTable.id, id), eq(officeOpsTasksTable.status, "open"))
    : eq(officeOpsTasksTable.id, id);

  const updatedRows = await db
    .update(officeOpsTasksTable)
    .set(setClause)
    .where(whereClause)
    .returning();

  if (updatedRows.length === 0) {
    // Another request completed it first. Return the current row, no rollover.
    const [now] = await db.select().from(officeOpsTasksTable).where(eq(officeOpsTasksTable.id, id));
    if (!now) {
      res.status(404).json({ error: "Office Ops task not found" });
      return;
    }
    res.json(serialize(now));
    return;
  }
  const updated = updatedRows[0];

  // On-completion recurrence rollover. Honor any recurrence change made in
  // the same PATCH (e.g. completing while flipping recurrence to "none"
  // stops the chain). Only runs when we actually transitioned the row.
  const finalRecurrenceRaw = updates.recurrence ?? existing.recurrence;
  const finalRecurrence: "daily" | "weekly" | "monthly" | null =
    finalRecurrenceRaw === "daily" || finalRecurrenceRaw === "weekly" || finalRecurrenceRaw === "monthly"
      ? finalRecurrenceRaw
      : null;
  if (willComplete && finalRecurrence) {
    const baseDate = existing.dueDate ?? existing.recurrenceAnchorDate ?? todayUtc();
    const nextDue = addToDate(baseDate, finalRecurrence);
    await db.insert(officeOpsTasksTable).values({
      title: existing.title,
      notes: existing.notes,
      status: "open",
      assigneeId: existing.assigneeId,
      createdById: existing.createdById,
      dueDate: nextDue,
      recurrence: finalRecurrence,
      recurrenceAnchorDate: existing.recurrenceAnchorDate ?? existing.dueDate ?? nextDue,
      parentRecurrenceId: existing.parentRecurrenceId ?? existing.id,
    });
  }

  res.json(serialize(updated));
});

router.delete("/office-ops/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireOfficeOpsAccess(req, res);
  if (!user) return;

  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin required" });
    return;
  }

  const id = parseTaskId(req.params.taskId);
  if (id === null) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  await db.delete(officeOpsTasksTable).where(eq(officeOpsTasksTable.id, id));
  res.sendStatus(204);
});

export default router;
