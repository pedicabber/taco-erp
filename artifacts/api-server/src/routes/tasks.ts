import { Router, type IRouter } from "express";
import { db, tasksTable, usersTable, departmentsTable, taskRelationsTable, taskAttachmentsTable, taskTimerSessionsTable, notificationsTable, activityLogTable, projectsTable } from "@workspace/db";
import { eq, and, inArray, or, isNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
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

const KANBAN_STATUSES = ["backlog", "in_progress", "in_review", "blocked", "complete"];
const KANBAN_LABELS: Record<string, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  in_review: "In Review",
  blocked: "Blocked",
  complete: "Complete",
};

async function buildTask(task: typeof tasksTable.$inferSelect) {
  let assignee = null;
  let assigner = null;
  let department = null;

  if (task.assigneeId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, task.assigneeId));
    if (u) {
      let deptName = null;
      if (u.departmentId) {
        const [d] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, u.departmentId));
        deptName = d?.name ?? null;
      }
      assignee = { id: u.id, name: u.name, avatarUrl: u.avatarUrl, departmentName: deptName };
    }
  }

  if (task.assignerId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, task.assignerId));
    if (u) {
      assignee = assignee; // already set
      assigner = { id: u.id, name: u.name, avatarUrl: u.avatarUrl, departmentName: null };
    }
  }

  if (task.departmentId) {
    const [d] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, task.departmentId));
    if (d) {
      department = { id: d.id, name: d.name, color: d.color };
    }
  }

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status as "backlog" | "in_progress" | "in_review" | "blocked" | "complete",
    priority: task.priority as "low" | "medium" | "high" | "urgent",
    projectId: task.projectId,
    departmentId: task.departmentId,
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

  const { projectId, departmentId, assigneeId, status } = req.query;

  const conditions = [];
  if (projectId) conditions.push(eq(tasksTable.projectId, Number(projectId)));
  if (departmentId) conditions.push(eq(tasksTable.departmentId, Number(departmentId)));
  if (assigneeId) conditions.push(eq(tasksTable.assigneeId, Number(assigneeId)));
  if (status) conditions.push(eq(tasksTable.status, String(status)));

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

router.delete("/tasks/:taskId", requireAuth, async (req, res): Promise<void> => {
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

router.delete("/tasks/:taskId/attachments/:attachmentId", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseInt(Array.isArray(req.params.taskId) ? req.params.taskId[0] : req.params.taskId, 10);
  const attachmentId = parseInt(Array.isArray(req.params.attachmentId) ? req.params.attachmentId[0] : req.params.attachmentId, 10);

  await db.delete(taskAttachmentsTable).where(
    and(eq(taskAttachmentsTable.id, attachmentId), eq(taskAttachmentsTable.taskId, taskId))
  );
  res.sendStatus(204);
});

// Kanban view
router.get("/kanban", requireAuth, async (req, res): Promise<void> => {
  let query = db.select().from(tasksTable).$dynamic();
  const conditions = [];
  if (req.query.projectId) conditions.push(eq(tasksTable.projectId, Number(req.query.projectId)));
  if (req.query.departmentId) conditions.push(eq(tasksTable.departmentId, Number(req.query.departmentId)));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const tasks = await query.orderBy(tasksTable.createdAt);
  const built = await Promise.all(tasks.map(buildTask));

  const columns = KANBAN_STATUSES.map(status => ({
    status,
    label: KANBAN_LABELS[status],
    tasks: built.filter(t => t.status === status),
  }));

  res.json(GetKanbanColumnsResponse.parse(columns));
});

// Calendar events
router.get("/calendar/events", requireAuth, async (req, res): Promise<void> => {
  let query = db.select().from(tasksTable).$dynamic();
  const conditions = [];
  if (req.query.projectId) conditions.push(eq(tasksTable.projectId, Number(req.query.projectId)));
  if (req.query.departmentId) conditions.push(eq(tasksTable.departmentId, Number(req.query.departmentId)));
  if (req.query.assigneeId) conditions.push(eq(tasksTable.assigneeId, Number(req.query.assigneeId)));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const tasks = await query;
  const projectIds = [...new Set(tasks.map(t => t.projectId))];
  const deptIds = [...new Set(tasks.map(t => t.departmentId).filter(Boolean))] as number[];

  const projects = projectIds.length > 0 ? await db.select().from(projectsTable).where(inArray(projectsTable.id, projectIds)) : [];
  const depts = deptIds.length > 0 ? await db.select().from(departmentsTable).where(inArray(departmentsTable.id, deptIds)) : [];

  const projectMap = new Map(projects.map(p => [p.id, p]));
  const deptMap = new Map(depts.map(d => [d.id, d]));

  const events = await Promise.all(tasks.map(async task => {
    const project = projectMap.get(task.projectId);
    const dept = task.departmentId ? deptMap.get(task.departmentId) : null;
    let assigneeName: string | null = null;
    if (task.assigneeId) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, task.assigneeId));
      assigneeName = u?.name ?? null;
    }

    return {
      taskId: task.id,
      title: task.title,
      status: task.status,
      startDate: task.startDate,
      dueDate: task.dueDate,
      expectedHours: task.expectedHours,
      elapsedSeconds: task.elapsedSeconds,
      timerRunning: task.timerRunning,
      projectId: task.projectId,
      projectName: project?.name ?? "Unknown Project",
      departmentId: task.departmentId,
      departmentName: dept?.name ?? null,
      departmentColor: dept?.color ?? null,
      assigneeId: task.assigneeId,
      assigneeName,
    };
  }));

  res.json(GetCalendarEventsResponse.parse(events));
});

// Dashboard summary
router.get("/dashboard/summary", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);

  const tasks = await db.select().from(tasksTable);
  const projects = await db.select().from(projectsTable);
  const now = new Date();

  const totalTasks = tasks.length;
  const tasksInProgress = tasks.filter(t => t.status === "in_progress").length;
  const tasksCompleted = tasks.filter(t => t.status === "complete").length;
  const overdueTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== "complete").length;
  const totalProjects = projects.length;
  const activeProjects = projects.filter(p => p.status === "active").length;

  let myTasks = 0;
  let myOverdueTasks = 0;
  if (user) {
    myTasks = tasks.filter(t => t.assigneeId === user.id).length;
    myOverdueTasks = tasks.filter(t => t.assigneeId === user.id && t.dueDate && new Date(t.dueDate) < now && t.status !== "complete").length;
  }

  res.json(GetDashboardSummaryResponse.parse({
    totalProjects,
    activeProjects,
    totalTasks,
    overdueTasks,
    tasksInProgress,
    tasksCompleted,
    myTasks,
    myOverdueTasks,
  }));
});

// Activity feed
router.get("/activity", requireAuth, async (req, res): Promise<void> => {
  const limit = parseInt(req.query.limit as string ?? "20", 10);

  const logs = await db
    .select()
    .from(activityLogTable)
    .orderBy(activityLogTable.createdAt)
    .limit(isNaN(limit) ? 20 : limit);

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
      createdAt: log.createdAt.toISOString(),
    };
  });

  res.json(GetActivityFeedResponse.parse(feed));
});

export default router;
