import { Router, type IRouter } from "express";
import { db, officeOpsTasksTable } from "@workspace/db";
import { and, eq, lt, or, isNull, desc, sql } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireOfficeOpsAccess } from "../lib/officeOpsAccess";
import {
  CreateOfficeOpsTaskBody,
  UpdateOfficeOpsTaskBody,
  ListOfficeOpsTasksQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

type OfficeOpsRow = typeof officeOpsTasksTable.$inferSelect;
type Recurrence = "none" | "daily" | "weekly" | "monthly";

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
    recurrence: t.recurrence as Recurrence,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Today as YYYY-MM-DD in UTC. dueDate is a calendar date, no timezone. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
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
  const today = todayUtc();

  // ---------------------------------------------------------------------------
  // Filter semantics under the persistent-row recurrence model
  // ---------------------------------------------------------------------------
  // open     → operational board. ALL recurring rows (the client decides muted
  //            vs active based on the current cycle window) PLUS one-time
  //            tasks still in status='open'.
  // completed→ one-time completed tasks only. Recurring tasks have no
  //            historical row to show; their "completed for this cycle" state
  //            lives transiently on the open board.
  // overdue  → cycle-aware. One-time: dueDate < today AND status='open'.
  //            Recurring: cycle window has closed without completion (i.e.
  //            previous cycle was never completed). Daily example: yesterday
  //            passed with no completion this week start. We compute this with
  //            UTC date math directly in SQL.
  // ---------------------------------------------------------------------------

  if (filter === "open") {
    const openOneTimeOrAnyRecurring = or(
      and(eq(officeOpsTasksTable.recurrence, "none"), eq(officeOpsTasksTable.status, "open")),
      sql`${officeOpsTasksTable.recurrence} <> 'none'`,
    );
    if (openOneTimeOrAnyRecurring) conditions.push(openOneTimeOrAnyRecurring as ReturnType<typeof eq>);
  } else if (filter === "completed") {
    conditions.push(eq(officeOpsTasksTable.recurrence, "none"));
    conditions.push(eq(officeOpsTasksTable.status, "completed"));
  } else {
    // overdue
    const oneTimeOverdue = and(
      eq(officeOpsTasksTable.recurrence, "none"),
      eq(officeOpsTasksTable.status, "open"),
      lt(officeOpsTasksTable.dueDate, today),
    );
    // Recurring overdue: completedAt < start of CURRENT cycle (or null) AND
    // we are past the start of the current cycle by at least one full window
    // — i.e. the previous cycle closed unfinished. Implemented per recurrence
    // by comparing completedAt to date_trunc('day'|'week'|'month', now()).
    // UTC-anchored cycle start as a timestamptz: date_trunc on `now() AT TIME
    // ZONE 'UTC'` returns a naive timestamp at UTC, then `AT TIME ZONE 'UTC'`
    // re-attaches the UTC offset so the comparison with `completed_at`
    // (timestamptz) is unambiguous regardless of session timezone.
    const dailyOverdue = and(
      eq(officeOpsTasksTable.recurrence, "daily"),
      or(
        isNull(officeOpsTasksTable.completedAt),
        sql`${officeOpsTasksTable.completedAt} < (date_trunc('day',   now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
      ),
    );
    const weeklyOverdue = and(
      eq(officeOpsTasksTable.recurrence, "weekly"),
      or(
        isNull(officeOpsTasksTable.completedAt),
        sql`${officeOpsTasksTable.completedAt} < (date_trunc('week',  now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
      ),
    );
    const monthlyOverdue = and(
      eq(officeOpsTasksTable.recurrence, "monthly"),
      or(
        isNull(officeOpsTasksTable.completedAt),
        sql`${officeOpsTasksTable.completedAt} < (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
      ),
    );
    const overdueAny = or(oneTimeOverdue, dailyOverdue, weeklyOverdue, monthlyOverdue);
    if (overdueAny) conditions.push(overdueAny as ReturnType<typeof eq>);
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
  void user; // edit/complete authorization is the access gate alone (product decision #2)

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

  const updates = parsed.data;
  const willComplete = updates.status === "completed" && existing.status !== "completed";
  const reopening = updates.status === "open" && existing.status === "completed";

  // Persistent-row model: completion is JUST status + completedAt. Reopening
  // clears completedAt so the row appears active immediately. No INSERT path
  // exists in this handler — recurring tasks reactivate implicitly on the
  // next cycle boundary via the GET filter / client cycle calc.
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

  const [updated] = await db
    .update(officeOpsTasksTable)
    .set(setClause)
    .where(eq(officeOpsTasksTable.id, id))
    .returning();

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

  // Creator-or-admin delete (preserved from Task #15).
  if (existing.createdById !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "Only the creator or an admin may delete this task" });
    return;
  }

  await db.delete(officeOpsTasksTable).where(eq(officeOpsTasksTable.id, id));
  res.sendStatus(204);
});

export default router;
