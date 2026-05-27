import { Router, type IRouter } from "express";
import { db, officeOpsTasksTable } from "@workspace/db";
import { and, eq, lt, or, isNull, desc, ne, sql } from "drizzle-orm";
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
    nextInstanceId: t.nextInstanceId,
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

  // Daily tasks completed *today* are operationally "still on the board" and
  // belong in the Daily section of the Open tab with line-through styling.
  // The Completed tab must hide them so they don't appear in both views.
  const today = todayUtc();
  const dailyCompletedToday = and(
    eq(officeOpsTasksTable.status, "completed"),
    eq(officeOpsTasksTable.recurrence, "daily"),
    sql`${officeOpsTasksTable.completedAt} AT TIME ZONE 'UTC' >= ${today}::date`,
    sql`${officeOpsTasksTable.completedAt} AT TIME ZONE 'UTC' <  (${today}::date + 1)`,
  );

  if (filter === "open") {
    const openOrDailyDoneToday = or(
      eq(officeOpsTasksTable.status, "open"),
      dailyCompletedToday,
    );
    if (openOrDailyDoneToday) conditions.push(openOrDailyDoneToday as ReturnType<typeof eq>);
  } else if (filter === "completed") {
    conditions.push(eq(officeOpsTasksTable.status, "completed"));
    // Exclude daily completed-today (those live in the Open tab's Daily section).
    const notDailyToday = or(
      ne(officeOpsTasksTable.recurrence, "daily"),
      isNull(officeOpsTasksTable.completedAt),
      sql`${officeOpsTasksTable.completedAt} AT TIME ZONE 'UTC' <  ${today}::date`,
    );
    if (notDailyToday) conditions.push(notDailyToday as ReturnType<typeof eq>);
  } else {
    // overdue
    conditions.push(eq(officeOpsTasksTable.status, "open"));
    conditions.push(lt(officeOpsTasksTable.dueDate, today));
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

  // On-completion recurrence rollover. Compute next instance from the MERGED
  // post-update state, not the pre-update row, so same-request edits to
  // title/notes/dueDate/assignee/recurrence are reflected in the new row.
  // Honors completing while flipping recurrence to "none" (stops the chain).
  const merged = {
    title: updates.title ?? existing.title,
    notes: updates.notes !== undefined ? updates.notes : existing.notes,
    assigneeId: updates.assigneeId !== undefined ? updates.assigneeId : existing.assigneeId,
    dueDate: updates.dueDate !== undefined ? updates.dueDate : existing.dueDate,
    recurrence: updates.recurrence ?? existing.recurrence,
  };
  const finalRecurrence: "daily" | "weekly" | "monthly" | null =
    merged.recurrence === "daily" || merged.recurrence === "weekly" || merged.recurrence === "monthly"
      ? merged.recurrence
      : null;
  // Idempotency latch: once this row has spawned its successor, never spawn
  // another from it — even across reopen → recomplete cycles. Reopening does
  // NOT clear `nextInstanceId` (see PATCH set clause above).
  if (willComplete && finalRecurrence && existing.nextInstanceId == null) {
    const baseDate = merged.dueDate ?? existing.recurrenceAnchorDate ?? todayUtc();
    const nextDue = addToDate(baseDate, finalRecurrence);
    // Belt-and-suspenders against an in-flight concurrent rollover: only
    // INSERT if this row's nextInstanceId is still NULL. The conditional
    // UPDATE that follows is the actual atomic claim.
    const [child] = await db.insert(officeOpsTasksTable).values({
      title: merged.title,
      notes: merged.notes,
      status: "open",
      assigneeId: merged.assigneeId,
      createdById: existing.createdById,
      dueDate: nextDue,
      recurrence: finalRecurrence,
      recurrenceAnchorDate: existing.recurrenceAnchorDate ?? merged.dueDate ?? nextDue,
      parentRecurrenceId: existing.parentRecurrenceId ?? existing.id,
    }).returning();

    // Atomically claim the latch. If a concurrent request beat us to it, the
    // WHERE clause matches zero rows and we delete the orphan child we just
    // inserted, leaving the winning rollover intact.
    const claimed = await db
      .update(officeOpsTasksTable)
      .set({ nextInstanceId: child.id })
      .where(and(eq(officeOpsTasksTable.id, existing.id), isNull(officeOpsTasksTable.nextInstanceId)))
      .returning({ id: officeOpsTasksTable.id });

    if (claimed.length === 0) {
      await db.delete(officeOpsTasksTable).where(eq(officeOpsTasksTable.id, child.id));
    } else {
      // Reflect the claim on the row we're about to return.
      (updated as { nextInstanceId: number | null }).nextInstanceId = child.id;
    }
  }

  res.json(serialize(updated));
});

router.delete("/office-ops/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await requireOfficeOpsAccess(req, res);
  if (!user) return;

  const id = parseTaskId(req.params.taskId);
  if (id === null) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const [existing] = await db.select().from(officeOpsTasksTable).where(eq(officeOpsTasksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Office Ops task not found" });
    return;
  }

  // Creator-or-admin delete: admins can remove anything; other Office Ops
  // members can only remove tasks they created. Prevents accidental loss of
  // someone else's recurring workflow while removing admin dependence.
  if (existing.createdById !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "Only the creator or an admin may delete this task" });
    return;
  }

  await db.delete(officeOpsTasksTable).where(eq(officeOpsTasksTable.id, id));
  res.sendStatus(204);
});

export default router;
