import { Router, type IRouter } from "express";
import { db, tasksTable, usersTable, departmentsTable, taskRelationsTable, taskAttachmentsTable, taskTimerSessionsTable, notificationsTable, activityLogTable, projectsTable, kanbanColumnsTable } from "@workspace/db";
import { eq, and, inArray, or, isNull, desc, gte, lte, count, asc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { syncUserFromClerk } from "../lib/userSync";
import { createNotification } from "./notifications";
import {
  ListTasksResponse,
  CreateTaskBody,
  GetTaskResponse,
  UpdateTaskBody,
  UpdateTaskResponse,
  StartTaskTimerResponse,
  StopTaskTimerResponse,
  EditTaskTimerBody,
  EditTaskTimerResponse,
  FollowTaskResponse,
  UnfollowTaskResponse,
  GetTaskRelationsResponse,
  AddTaskRelationBody,
  ListTaskAttachmentsResponse,
  AddTaskAttachmentBody,
  GetKanbanColumnsResponse,
  GetCalendarEventsResponse,
  GetDashboardSummaryResponse,
  GetActivityFeedResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseCreateKanbanColumnBody(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  if (typeof data.label !== "string" || data.label.trim() === "") return null;
  if (typeof data.hexColor !== "string" || data.hexColor.trim() === "") return null;
  return { label: data.label, hexColor: data.hexColor };
}

function parseUpdateKanbanColumnBody(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  const parsed: Partial<{ label: string; hexColor: string; sortOrder: number }> = {};
  if (data.label !== undefined) {
    if (typeof data.label !== "string" || data.label.trim() === "") return null;
    parsed.label = data.label;
  }
  if (data.hexColor !== undefined) {
    if (typeof data.hexColor !== "string" || data.hexColor.trim() === "") return null;
    parsed.hexColor = data.hexColor;
  }
  if (data.sortOrder !== undefined) {
    if (typeof data.sortOrder !== "number") return null;
    parsed.sortOrder = data.sortOrder;
  }
  return parsed;
}

const DEFAULT_COLUMNS = [
  { statusKey: "backlog",     label: "Backlog",      hexColor: "#94a3b8", sortOrder: 0 },
  { statusKey: "new_tasks",   label: "New Tasks",    hexColor: "#f59e0b", sortOrder: 1 },
  { statusKey: "in_progress", label: "In Progress",  hexColor: "#3b82f6", sortOrder: 2 },
  { statusKey: "in_review",   label: "In Review",    hexColor: "#a855f7", sortOrder: 3 },
  { statusKey: "blocked",     label: "Blocked",      hexColor: "#ef4444", sortOrder: 4 },
  { statusKey: "complete",    label: "Complete",     hexColor: "#22c55e", sortOrder: 5 },
];

async function seedDefaultColumns() {
  try {
    const existing = await db.select().from(kanbanColumnsTable);
    if (existing.length === 0) {
      await db.insert(kanbanColumnsTable).values(DEFAULT_COLUMNS);
      return;
    }
    // Ensure new_tasks column exists (for already-seeded databases)
    const hasNewTasks = existing.some(c => c.statusKey === "new_tasks");
    if (!hasNewTasks) {
      // Shift all columns with sortOrder >= 1 up by 1 to make room
      for (const col of existing) {
        if (col.sortOrder >= 1) {
          await db.update(kanbanColumnsTable)
            .set({ sortOrder: col.sortOrder + 1 })
            .where(eq(kanbanColumnsTable.id, col.id));
        }
      }
      await db.insert(kanbanColumnsTable).values({
        statusKey: "new_tasks",
        label: "New Tasks",
        hexColor: "#f59e0b",
        sortOrder: 1,
      });
    }
  } catch {
    // ignore — table may not exist yet during first boot before migration
  }
}

seedDefaultColumns();

async function buildTask(task: typeof tasksTable.$inferSelect) {
  let assignee = null;
  let assigner = null;
  let department = null;
  let assigneeDept: { id: number; name: string; color: string | null } | null = null;

  if (task.assigneeId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, task.assigneeId));
    if (u) {
      let deptName = null;
      if (u.departmentId) {
        const [d] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, u.departmentId));
        if (d) {
          deptName = d.name;
          assigneeDept = { id: d.id, name: d.name, color: d.color };
        }
      }
      assignee = { id: u.id, name: u.name, avatarUrl: u.avatarUrl, departmentName: deptName };
    }
  }

  if (task.assignerId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, task.assignerId));
    if (u) {
      assigner = { id: u.id, name: u.name, avatarUrl: u.avatarUrl, departmentName: null };
    }
  }

  if (task.departmentId) {
    const [d] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, task.departmentId));
    if (d) {
      department = { id: d.id, name: d.name, color: d.color };
    }
  }

  // Fallback: if no direct department set on task, use the assignee's department
  if (!department && assigneeDept) {
    department = assigneeDept;
  }

  const [subtaskRow] = await db.select({ cnt: count() }).from(tasksTable).where(eq(tasksTable.parentTaskId, task.id));
  const subtaskCount = Number(subtaskRow?.cnt ?? 0);

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status as "backlog" | "in_progress" | "in_review" | "blocked" | "complete",
    priority: task.priority as "low" | "medium" | "high" | "urgent",
    projectId: task.projectId,
    departmentId: task.departmentId,
    parentTaskId: task.parentTaskId ?? null,
    subtaskCount,
    assigneeId: task.assigneeId,
    assignerId: task.assignerId,
    followerIds: task.followerIds ?? [],
    expectedHours: task.expectedHours,
    dueDate: task.dueDate,
    startDate: task.startDate,
    elapsedSeconds: task.elapsedSeconds,
    timerRunning: task.timerRunning,
    timerStartedAt: task.timerStartedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    safetyFlag: task.safetyFlag ?? null,
    qualityResult: task.qualityResult ?? null,
    deliveryStatus: task.deliveryStatus ?? null,
    costMaterialNotes: task.costMaterialNotes ?? null,
    notes: task.notes ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    assignee,
    assigner,
    department,
  };
}

async function checkOverdueAndNotify(task: typeof tasksTable.$inferSelect): Promise<void> {
  if (!task.dueDate || task.status === "complete") return;

  const dueDate = new Date(task.dueDate);
  const now = new Date();
  if (dueDate < now) {
    const notifyIds = new Set<number>();
    if (task.assigneeId) notifyIds.add(task.assigneeId);
    if (task.assignerId) notifyIds.add(task.assignerId);
    for (const fId of task.followerIds ?? []) notifyIds.add(fId);

    for (const userId of notifyIds) {
      await createNotification(userId, task.id, "overdue", `Task "${task.title}" is overdue!`);
    }
  }

  if (task.expectedHours && task.elapsedSeconds > task.expectedHours * 3600) {
    const elapsed = (task.elapsedSeconds / 3600).toFixed(1);
    const notifyIds = new Set<number>();
    if (task.assigneeId) notifyIds.add(task.assigneeId);
    if (task.assignerId) notifyIds.add(task.assignerId);
    for (const fId of task.followerIds ?? []) notifyIds.add(fId);

    for (const userId of notifyIds) {
      await createNotification(userId, task.id, "timer_alert",
        `Task "${task.title}" has exceeded the expected timeline (${elapsed}h elapsed, ${task.expectedHours}h expected)`
      );
    }
  }
}

async function logActivity(taskId: number, actorId: number, action: string): Promise<void> {
  await db.insert(activityLogTable).values({ taskId, actorId, action });
}

router.get("/tasks", requireAuth, async (req, res): Promise<void> => {
  let query = db.select().from(tasksTable).$dynamic();

  const { projectId, departmentId, assigneeId, status, parentTaskId, topLevelOnly } = req.query;

  const conditions = [];
  if (projectId) conditions.push(eq(tasksTable.projectId, Number(projectId)));
  if (departmentId) conditions.push(eq(tasksTable.departmentId, Number(departmentId)));
  if (assigneeId) conditions.push(eq(tasksTable.assigneeId, Number(assigneeId)));
  if (status) conditions.push(eq(tasksTable.status, String(status)));
  if (parentTaskId) conditions.push(eq(tasksTable.parentTaskId, Number(parentTaskId)));
  if (topLevelOnly === "true") conditions.push(isNull(tasksTable.parentTaskId));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const tasks = await query.orderBy(tasksTable.createdAt);
  const built = await Promise.all(tasks.map(buildTask));
  res.json(ListTasksResponse.parse(built));
});

router.post("/tasks", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [task] = await db.insert(tasksTable).values({
    ...parsed.data,
    status: parsed.data.status ?? "backlog",
    priority: parsed.data.priority ?? "medium",
    assignerId: user.id,
    followerIds: [],
    elapsedSeconds: 0,
    timerRunning: false,
  }).returning();

  await logActivity(task.id, user.id, "created task");

  if (parsed.data.assigneeId && parsed.data.assigneeId !== user.id) {
    await createNotification(parsed.data.assigneeId, task.id, "assigned", `You have been assigned to "${task.title}"`);
  }

  const built = await buildTask(task);
  res.status(201).json(GetTaskResponse.parse(built));
});

router.get("/tasks/:taskId", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const built = await buildTask(task);
  res.json(GetTaskResponse.parse(built));
});

router.patch("/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof tasksTable.$inferInsert> = { ...parsed.data };

  if (parsed.data.status === "complete") {
    updates.completedAt = new Date();
    updates.timerRunning = false;
    const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (current?.timerRunning && current.timerStartedAt) {
      const extraSeconds = Math.floor((Date.now() - current.timerStartedAt.getTime()) / 1000);
      updates.elapsedSeconds = (current.elapsedSeconds ?? 0) + extraSeconds;
      updates.timerStartedAt = null;
    }
  } else if (parsed.data.status && parsed.data.status !== "complete") {
    // If moving away from complete, clear the completedAt timestamp
    const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (current?.status === "complete") {
      updates.completedAt = null;
    }
  }

  const [updated] = await db.update(tasksTable).set(updates).where(eq(tasksTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (user) await logActivity(id, user.id, `updated task status to ${updated.status}`);
  await checkOverdueAndNotify(updated);

  if (parsed.data.assigneeId && user && parsed.data.assigneeId !== user.id) {
    await createNotification(parsed.data.assigneeId, id, "assigned", `You have been assigned to "${updated.title}"`);
  }

  const built = await buildTask(updated);
  res.json(UpdateTaskResponse.parse(built));
});

router.delete("/tasks/:taskId", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  res.sendStatus(204);
});

router.post("/tasks/:taskId/timer/start", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (current.timerRunning) {
    const built = await buildTask(current);
    res.json(StartTaskTimerResponse.parse(built));
    return;
  }

  const startedAt = new Date();
  const [updated] = await db.update(tasksTable).set({
    timerRunning: true,
    timerStartedAt: startedAt,
    status: current.status === "backlog" ? "in_progress" : current.status,
  }).where(eq(tasksTable.id, id)).returning();

  if (user) {
    await db.insert(taskTimerSessionsTable).values({
      taskId: id,
      startedById: user.id,
      startedAt,
    });
    await logActivity(id, user.id, "started timer");
  }

  const built = await buildTask(updated);
  res.json(StartTaskTimerResponse.parse(built));
});

router.post("/tasks/:taskId/timer/stop", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (!current.timerRunning || !current.timerStartedAt) {
    const built = await buildTask(current);
    res.json(StopTaskTimerResponse.parse(built));
    return;
  }

  const stoppedAt = new Date();
  const extraSeconds = Math.floor((stoppedAt.getTime() - current.timerStartedAt.getTime()) / 1000);
  const [updated] = await db.update(tasksTable).set({
    timerRunning: false,
    timerStartedAt: null,
    elapsedSeconds: (current.elapsedSeconds ?? 0) + extraSeconds,
  }).where(eq(tasksTable.id, id)).returning();

  await db
    .update(taskTimerSessionsTable)
    .set({ stoppedAt, durationSeconds: extraSeconds })
    .where(
      and(
        eq(taskTimerSessionsTable.taskId, id),
        isNull(taskTimerSessionsTable.stoppedAt)
      )
    );

  if (user) await logActivity(id, user.id, "stopped timer");
  await checkOverdueAndNotify(updated);

  const built = await buildTask(updated);
  res.json(StopTaskTimerResponse.parse(built));
});

router.patch("/tasks/:taskId/timer/edit", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const parsed = EditTaskTimerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db.update(tasksTable).set({
    elapsedSeconds: parsed.data.elapsedSeconds,
  }).where(eq(tasksTable.id, id)).returning();

  if (!updated) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (user) await logActivity(id, user.id, "edited timer");
  await checkOverdueAndNotify(updated);

  const built = await buildTask(updated);
  res.json(EditTaskTimerResponse.parse(built));
});

router.get("/tasks/:taskId/timer/sessions", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const rows = await db
    .select({
      id: taskTimerSessionsTable.id,
      taskId: taskTimerSessionsTable.taskId,
      startedById: taskTimerSessionsTable.startedById,
      startedAt: taskTimerSessionsTable.startedAt,
      stoppedAt: taskTimerSessionsTable.stoppedAt,
      durationSeconds: taskTimerSessionsTable.durationSeconds,
      startedByName: usersTable.name,
      startedByAvatarUrl: usersTable.avatarUrl,
    })
    .from(taskTimerSessionsTable)
    .leftJoin(usersTable, eq(usersTable.id, taskTimerSessionsTable.startedById))
    .where(eq(taskTimerSessionsTable.taskId, id))
    .orderBy(desc(taskTimerSessionsTable.startedAt));

  res.json(rows.map(row => ({
    id: row.id,
    taskId: row.taskId,
    startedById: row.startedById,
    startedBy: {
      id: row.startedById,
      name: row.startedByName ?? "Unknown user",
      avatarUrl: row.startedByAvatarUrl ?? null,
    },
    startedAt: row.startedAt.toISOString(),
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    durationSeconds: row.durationSeconds,
  })));
});

router.post("/tasks/:taskId/followers", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const followers = current.followerIds ?? [];
  if (!followers.includes(user.id)) {
    followers.push(user.id);
    await db.update(tasksTable).set({ followerIds: followers }).where(eq(tasksTable.id, id));
  }

  const updated = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).then(r => r[0]);
  const built = await buildTask(updated);
  res.json(FollowTaskResponse.parse(built));
});

router.delete("/tasks/:taskId/followers", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const followers = (current.followerIds ?? []).filter(fId => fId !== user.id);
  await db.update(tasksTable).set({ followerIds: followers }).where(eq(tasksTable.id, id));

  const updated = await db.select().from(tasksTable).where(eq(tasksTable.id, id)).then(r => r[0]);
  const built = await buildTask(updated);
  res.json(UnfollowTaskResponse.parse(built));
});

router.get("/tasks/:taskId/relations", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const relations = await db.select().from(taskRelationsTable).where(
    or(eq(taskRelationsTable.taskId, id), eq(taskRelationsTable.relatedTaskId, id))
  );

  const relatedIds = relations.map(r => r.taskId === id ? r.relatedTaskId : r.taskId);
  if (relatedIds.length === 0) {
    res.json(GetTaskRelationsResponse.parse([]));
    return;
  }

  const relatedTasks = await db.select().from(tasksTable).where(inArray(tasksTable.id, relatedIds));
  const built = await Promise.all(relatedTasks.map(buildTask));
  res.json(GetTaskRelationsResponse.parse(built));
});

router.post("/tasks/:taskId/relations", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const parsed = AddTaskRelationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.insert(taskRelationsTable).values({ taskId: id, relatedTaskId: parsed.data.relatedTaskId });
  res.sendStatus(201);
});

router.delete("/tasks/:taskId/relations", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const parsed = AddTaskRelationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.delete(taskRelationsTable).where(
    or(
      and(eq(taskRelationsTable.taskId, id), eq(taskRelationsTable.relatedTaskId, parsed.data.relatedTaskId)),
      and(eq(taskRelationsTable.taskId, parsed.data.relatedTaskId), eq(taskRelationsTable.relatedTaskId, id))
    )
  );
  res.sendStatus(204);
});

router.get("/tasks/:taskId/attachments", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const attachments = await db.select().from(taskAttachmentsTable).where(eq(taskAttachmentsTable.taskId, id)).orderBy(taskAttachmentsTable.createdAt);

  res.json(ListTaskAttachmentsResponse.parse(attachments.map(a => ({
    id: a.id,
    taskId: a.taskId,
    fileName: a.fileName,
    objectPath: a.objectPath,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    uploadedById: a.uploadedById,
    createdAt: a.createdAt.toISOString(),
  }))));
});

router.post("/tasks/:taskId/attachments", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const parsed = AddTaskAttachmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Matches /objects/uploads/UUID or /objects/UUID (any reasonable sub-path)
  const OBJECT_PATH_RE = /^\/objects\/[a-z0-9/_-]+$/i;
  if (!OBJECT_PATH_RE.test(parsed.data.objectPath)) {
    req.log.warn({ objectPath: parsed.data.objectPath }, "Rejected objectPath");
    res.status(400).json({ error: "Invalid object path", received: parsed.data.objectPath });
    return;
  }

  const existingAttachment = await db
    .select({ id: taskAttachmentsTable.id })
    .from(taskAttachmentsTable)
    .where(eq(taskAttachmentsTable.objectPath, parsed.data.objectPath));

  if (existingAttachment.length > 0) {
    res.status(409).json({ error: "Object already attached" });
    return;
  }

  const [attachment] = await db.insert(taskAttachmentsTable).values({
    taskId: id,
    fileName: parsed.data.fileName,
    objectPath: parsed.data.objectPath,
    fileSize: parsed.data.fileSize ?? null,
    mimeType: parsed.data.mimeType ?? null,
    uploadedById: user.id,
  }).returning();

  res.status(201).json({
    id: attachment.id,
    taskId: attachment.taskId,
    fileName: attachment.fileName,
    objectPath: attachment.objectPath,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    uploadedById: attachment.uploadedById,
    createdAt: attachment.createdAt.toISOString(),
  });
});

router.delete("/tasks/:taskId/attachments/:attachmentId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const taskId = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  const attachmentId = parseInt(Array.isArray(req.params.attachmentId) ? req.params.attachmentId[0] : req.params.attachmentId, 10);
  const clerkId = req.userId;

  if (!clerkId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [dbUser] = await db.select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));

  if (!dbUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [attachment] = await db.select({ uploadedById: taskAttachmentsTable.uploadedById })
    .from(taskAttachmentsTable)
    .where(and(eq(taskAttachmentsTable.id, attachmentId), eq(taskAttachmentsTable.taskId, taskId)));

  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  if (dbUser.role !== "admin" && attachment.uploadedById !== dbUser.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.delete(taskAttachmentsTable).where(
    and(eq(taskAttachmentsTable.id, attachmentId), eq(taskAttachmentsTable.taskId, taskId))
  );
  res.sendStatus(204);
});

// Kanban column CRUD
router.get("/kanban/columns", requireAuth, async (_req, res): Promise<void> => {
  const cols = await db.select().from(kanbanColumnsTable).orderBy(asc(kanbanColumnsTable.sortOrder));
  res.json(cols.map(c => ({
    id: c.id, statusKey: c.statusKey, label: c.label, hexColor: c.hexColor, sortOrder: c.sortOrder,
  })));
});

router.post("/kanban/columns", requireAuth, async (req, res): Promise<void> => {
  const body = parseCreateKanbanColumnBody(req.body);
  if (!body) { res.status(400).json({ error: "Invalid body" }); return; }
  const existing = await db.select().from(kanbanColumnsTable).orderBy(asc(kanbanColumnsTable.sortOrder));
  const statusKey = `col_${Date.now()}`;
  const sortOrder = existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0;
  const [col] = await db.insert(kanbanColumnsTable)
    .values({ statusKey, label: body.label, hexColor: body.hexColor, sortOrder })
    .returning();
  res.status(201).json({ id: col.id, statusKey: col.statusKey, label: col.label, hexColor: col.hexColor, sortOrder: col.sortOrder });
});

router.patch("/kanban/columns/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const body = parseUpdateKanbanColumnBody(req.body);
  if (!body) { res.status(400).json({ error: "Invalid body" }); return; }
  const updates: Partial<{ label: string; hexColor: string; sortOrder: number }> = {};
  if (body.label !== undefined) updates.label = body.label;
  if (body.hexColor !== undefined) updates.hexColor = body.hexColor;
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
  const [col] = await db.update(kanbanColumnsTable).set(updates).where(eq(kanbanColumnsTable.id, id)).returning();
  if (!col) { res.status(404).json({ error: "Column not found" }); return; }
  res.json({ id: col.id, statusKey: col.statusKey, label: col.label, hexColor: col.hexColor, sortOrder: col.sortOrder });
});

router.delete("/kanban/columns/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [col] = await db.select().from(kanbanColumnsTable).where(eq(kanbanColumnsTable.id, id));
  if (!col) { res.status(404).json({ error: "Column not found" }); return; }
  const taskCount = await db.select({ cnt: count() }).from(tasksTable).where(eq(tasksTable.status, col.statusKey));
  if ((taskCount[0]?.cnt ?? 0) > 0) {
    res.status(400).json({ error: "Cannot delete column that still has tasks. Move them first." });
    return;
  }
  await db.delete(kanbanColumnsTable).where(eq(kanbanColumnsTable.id, id));
  res.status(204).end();
});

// Kanban view
router.get("/kanban", requireAuth, async (req, res): Promise<void> => {
  let query = db.select().from(tasksTable).$dynamic();
  const conditions = [isNull(tasksTable.parentTaskId)];
  if (req.query.projectId) conditions.push(eq(tasksTable.projectId, Number(req.query.projectId)));
  if (req.query.departmentId) conditions.push(eq(tasksTable.departmentId, Number(req.query.departmentId)));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const [dbCols, tasks] = await Promise.all([
    db.select().from(kanbanColumnsTable).orderBy(asc(kanbanColumnsTable.sortOrder)),
    query.orderBy(tasksTable.createdAt),
  ]);
  const built = await Promise.all(tasks.map(buildTask));

  const columns = dbCols.map(col => ({
    status: col.statusKey,
    label: col.label,
    hexColor: col.hexColor,
    sortOrder: col.sortOrder,
    tasks: built.filter(t => t.status === col.statusKey),
  }));

  res.json(GetKanbanColumnsResponse.parse(columns));
});

// Calendar events
router.get("/calendar/events", requireAuth, async (req, res): Promise<void> => {
  let query = db.select().from(tasksTable).$dynamic();
  const conditions = [isNull(tasksTable.parentTaskId)];
  if (req.query.projectId) conditions.push(eq(tasksTable.projectId, Number(req.query.projectId)));
  if (req.query.departmentId) conditions.push(eq(tasksTable.departmentId, Number(req.query.departmentId)));
  if (req.query.assigneeId) conditions.push(eq(tasksTable.assigneeId, Number(req.query.assigneeId)));
  if (req.query.status && typeof req.query.status === "string") {
    conditions.push(eq(tasksTable.status, req.query.status));
  }
  if (req.query.startDate && typeof req.query.startDate === "string") {
    conditions.push(gte(tasksTable.dueDate, req.query.startDate));
  }
  if (req.query.endDate && typeof req.query.endDate === "string") {
    conditions.push(lte(tasksTable.dueDate, req.query.endDate));
  }
  if (conditions.length > 0) query = query.where(and(...conditions));

  const tasks = await query;
  const projectIds = [...new Set(tasks.map(t => t.projectId))];
  const assigneeIds = [...new Set(tasks.map(t => t.assigneeId).filter(Boolean))] as number[];

  // Load assignee users in batch so we can fall back to their department color
  const assigneeUsers = assigneeIds.length > 0
    ? await db.select().from(usersTable).where(inArray(usersTable.id, assigneeIds))
    : [];
  const userMap = new Map(assigneeUsers.map(u => [u.id, u]));

  // Collect dept IDs from both task.departmentId and assignee user.departmentId
  const taskDeptIds = tasks.map(t => t.departmentId).filter(Boolean) as number[];
  const userDeptIds = assigneeUsers.map(u => u.departmentId).filter(Boolean) as number[];
  const deptIds = [...new Set([...taskDeptIds, ...userDeptIds])];

  const projects = projectIds.length > 0 ? await db.select().from(projectsTable).where(inArray(projectsTable.id, projectIds)) : [];
  const depts = deptIds.length > 0 ? await db.select().from(departmentsTable).where(inArray(departmentsTable.id, deptIds)) : [];

  const projectMap = new Map(projects.map(p => [p.id, p]));
  const deptMap = new Map(depts.map(d => [d.id, d]));

  const events = tasks.map(task => {
    const project = projectMap.get(task.projectId);
    const assigneeUser = task.assigneeId ? userMap.get(task.assigneeId) : null;

    // Resolve department: task's own dept first, then fall back to assignee's dept
    const dept = (task.departmentId ? deptMap.get(task.departmentId) : null)
      ?? (assigneeUser?.departmentId ? deptMap.get(assigneeUser.departmentId) : null)
      ?? null;

    return {
      taskId: task.id,
      title: task.title,
      status: task.status,
      startDate: task.startDate,
      dueDate: task.dueDate,
      expectedHours: task.expectedHours,
      elapsedSeconds: task.elapsedSeconds,
      timerRunning: task.timerRunning,
      timerStartedAt: task.timerStartedAt?.toISOString() ?? null,
      projectId: task.projectId,
      projectName: project?.name ?? "Unknown Project",
      departmentId: task.departmentId,
      departmentName: dept?.name ?? null,
      departmentColor: dept?.color ?? null,
      assigneeId: task.assigneeId,
      assigneeName: assigneeUser?.name ?? null,
      assigneeAvatarUrl: assigneeUser?.avatarUrl ?? null,
      priority: task.priority as "low" | "medium" | "high" | "urgent",
    };
  });

  res.json(GetCalendarEventsResponse.parse(events));
});

// Dashboard summary
router.get("/dashboard/summary", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);

  const tasks = await db.select().from(tasksTable);
  const projects = await db.select().from(projectsTable);
  const now = new Date();

  const topLevelTasks = tasks.filter(t => t.parentTaskId === null);
  const subtasks = tasks.filter(t => t.parentTaskId !== null);

  const totalTasks = topLevelTasks.length;
  const tasksInProgress = topLevelTasks.filter(t => t.status === "in_progress").length;
  const tasksCompleted = topLevelTasks.filter(t => t.status === "complete").length;
  const overdueTasks = topLevelTasks.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== "complete").length;
  const totalSubtasks = subtasks.length;
  const subtasksCompleted = subtasks.filter(t => t.status === "complete").length;
  const totalProjects = projects.length;
  const activeProjects = projects.filter(p => p.status === "active").length;

  let myTasks = 0;
  let myOverdueTasks = 0;
  if (user) {
    myTasks = topLevelTasks.filter(t => t.assigneeId === user.id).length;
    myOverdueTasks = topLevelTasks.filter(t => t.assigneeId === user.id && t.dueDate && new Date(t.dueDate) < now && t.status !== "complete").length;
  }

  res.json(GetDashboardSummaryResponse.parse({
    totalProjects,
    activeProjects,
    totalTasks,
    overdueTasks,
    tasksInProgress,
    tasksCompleted,
    totalSubtasks,
    subtasksCompleted,
    myTasks,
    myOverdueTasks,
  }));
});

// Activity feed
router.get("/activity", requireAuth, async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(req.query.limit as string ?? "20", 10), 100);
  const offset = parseInt(req.query.offset as string ?? "0", 10);

  const [{ count: totalCount }] = await db
    .select({ count: count() })
    .from(activityLogTable);

  const logs = await db
    .select()
    .from(activityLogTable)
    .orderBy(desc(activityLogTable.createdAt))
    .limit(isNaN(limit) ? 20 : limit)
    .offset(isNaN(offset) ? 0 : offset);

  const taskIds = [...new Set(logs.map(l => l.taskId))];
  const actorIds = [...new Set(logs.map(l => l.actorId))];

  const tasks = taskIds.length > 0 ? await db.select().from(tasksTable).where(inArray(tasksTable.id, taskIds)) : [];
  const actors = actorIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, actorIds)) : [];
  const taskProjects = tasks.length > 0
    ? await db.select().from(projectsTable).where(inArray(projectsTable.id, [...new Set(tasks.map(t => t.projectId))]))
    : [];

  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const actorMap = new Map(actors.map(a => [a.id, a]));
  const projectMap = new Map(taskProjects.map(p => [p.id, p]));

  const feed = logs.map(log => {
    const task = taskMap.get(log.taskId);
    const actor = actorMap.get(log.actorId);
    const project = task ? projectMap.get(task.projectId) : null;

    return {
      id: log.id,
      taskId: log.taskId,
      taskTitle: task?.title ?? "Unknown Task",
      projectName: project?.name ?? "Unknown Project",
      action: log.action,
      actorId: log.actorId,
      actorName: actor?.name ?? "Unknown User",
      actorAvatarUrl: actor?.avatarUrl ?? null,
      createdAt: log.createdAt.toISOString(),
    };
  });

  res.setHeader("X-Total-Count", String(totalCount));
  res.json(GetActivityFeedResponse.parse(feed));
});

router.get("/tasks/:taskId/subtask-attachments", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid task ID" }); return; }

  const subtasks = await db.select({ id: tasksTable.id, title: tasksTable.title })
    .from(tasksTable).where(eq(tasksTable.parentTaskId, id));

  if (subtasks.length === 0) { res.json([]); return; }

  const subtaskIds = subtasks.map(s => s.id);
  const allAttachments = await db.select().from(taskAttachmentsTable)
    .where(inArray(taskAttachmentsTable.taskId, subtaskIds))
    .orderBy(taskAttachmentsTable.createdAt);

  const attachmentsByTask = new Map<number, typeof allAttachments>();
  for (const a of allAttachments) {
    if (!attachmentsByTask.has(a.taskId)) attachmentsByTask.set(a.taskId, []);
    attachmentsByTask.get(a.taskId)!.push(a);
  }

  const result = subtasks
    .filter(s => attachmentsByTask.has(s.id))
    .map(s => ({
      taskId: s.id,
      taskTitle: s.title,
      attachments: (attachmentsByTask.get(s.id) ?? []).map(a => ({
        id: a.id,
        taskId: a.taskId,
        fileName: a.fileName,
        objectPath: a.objectPath,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        uploadedById: a.uploadedById,
        createdAt: a.createdAt.toISOString(),
      })),
    }));

  res.json(result);
});

export default router;
