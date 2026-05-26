import {
  db,
  projectsTable,
  departmentsTable,
  tasksTable,
  taskAssigneesTable,
  taskTemplatesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, isNull, ne, or, exists, type SQL } from "drizzle-orm";
import type { Response } from "express";

/**
 * Centralized rules for the hidden Office/Admin container project.
 *
 * The Office/Admin department's per-user task instances live under a single
 * sentinel project that is never exposed to normal users. Anywhere the API
 * returns or filters on projects, the sentinel must be excluded. Use the
 * helpers and SQL fragment exported from this module so the rules stay in
 * one place.
 */

export const OA_DEPT_NAME = "OFFICE/ADMIN";
export const OA_CONTAINER_PROJECT_NAME = "__OFFICE_ADMIN__";

/**
 * Intentionally NOT cached at module scope. A previous version cached
 * `cachedContainerId` and `cachedOADeptId` for the lifetime of the process;
 * after a prod → dev DB refresh (`pg_restore --clean`), the cached IDs
 * referred to rows that no longer existed, causing `rejectIfHiddenProject`
 * to false-positive against unrelated real projects whose IDs collided with
 * the old container ID. Both lookups are single-row equality queries against
 * tiny tables, so we resolve them live on every call.
 */

/** Drizzle WHERE fragment that excludes the hidden Office/Admin container. */
export const excludeOAContainerProject = ne(
  projectsTable.name,
  OA_CONTAINER_PROJECT_NAME,
);

export function isOAContainerProjectName(name: string | null | undefined): boolean {
  return name === OA_CONTAINER_PROJECT_NAME;
}

/** Friendly label to surface instead of the sentinel name when relabeling is unavoidable. */
export const OA_DISPLAY_LABEL = "Office / Admin";

export async function getOADepartmentId(): Promise<number | null> {
  const [d] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.name, OA_DEPT_NAME), isNull(departmentsTable.projectId)));
  return d?.id ?? null;
}

export async function getOAContainerProjectId(): Promise<number | null> {
  const [p] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.name, OA_CONTAINER_PROJECT_NAME));
  return p?.id ?? null;
}

export async function isHiddenProjectId(id: number): Promise<boolean> {
  const cid = await getOAContainerProjectId();
  return cid !== null && id === cid;
}

/**
 * SQL fragment that hides Office/Admin container tasks from anyone who is
 * not their assignee. Use in any cross-cutting task query (lists, kanban,
 * calendar) so non-OA users cannot enumerate the hidden container by
 * inspecting `projectId` on tasks they don't own.
 *
 * Returns `undefined` if the container has not been bootstrapped yet, in
 * which case there are no OA-container tasks to hide.
 */
export async function excludeForeignOAContainerTasks(
  userId: number | null | undefined,
): Promise<SQL | undefined> {
  const cid = await getOAContainerProjectId();
  if (cid === null) return undefined;
  if (userId == null) {
    return ne(tasksTable.projectId, cid);
  }
  return or(
    ne(tasksTable.projectId, cid),
    eq(tasksTable.assigneeId, userId),
    exists(
      db
        .select({ one: taskAssigneesTable.userId })
        .from(taskAssigneesTable)
        .where(
          and(
            eq(taskAssigneesTable.taskId, tasksTable.id),
            eq(taskAssigneesTable.userId, userId),
          ),
        ),
    ),
  );
}

/**
 * Single-task visibility guard for the hidden Office/Admin container.
 *
 * Returns true if the given task is inside the hidden container AND the user
 * is NOT one of its assignees (primary or secondary). Callers should treat
 * a true result like a 404 — not a 403 — so the existence of the hidden
 * container can never be inferred from the response code.
 *
 * Pass `null` for `userId` for unauthenticated requests.
 */
export async function isHiddenOATaskFromUser(
  task: { id: number; projectId: number; assigneeId: number | null },
  userId: number | null | undefined,
): Promise<boolean> {
  const cid = await getOAContainerProjectId();
  if (cid === null) return false;
  if (task.projectId !== cid) return false;
  if (userId == null) return true;
  if (task.assigneeId === userId) return false;
  const [row] = await db
    .select({ one: taskAssigneesTable.userId })
    .from(taskAssigneesTable)
    .where(
      and(
        eq(taskAssigneesTable.taskId, task.id),
        eq(taskAssigneesTable.userId, userId),
      ),
    )
    .limit(1);
  return !row;
}

/**
 * Sends a 404 and returns true if the given project id refers to the hidden
 * Office/Admin container. Use early in any route handler that operates on
 * `/projects/:projectId(/...)` so the sentinel is invisible from the outside.
 */
export async function rejectIfHiddenProject(res: Response, id: number): Promise<boolean> {
  if (await isHiddenProjectId(id)) {
    res.status(404).json({ error: "Project not found" });
    return true;
  }
  return false;
}

/** Idempotent on-boot creation of the hidden Office/Admin container project. */
export async function bootstrapOAContainerProject(): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.name, OA_CONTAINER_PROJECT_NAME));
    if (existing) {
      return;
    }

    const [admin] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));

    await db
      .insert(projectsTable)
      .values({
        name: OA_CONTAINER_PROJECT_NAME,
        company: "Internal",
        projectId: "OA-INTERNAL",
        status: "active",
        createdById: admin?.id ?? 0,
      });
  } catch {
    // Database may not be ready yet; will lazy-init on first request.
  }
}

/**
 * Idempotently seeds the Office/Admin template tasks as personal tasks for a
 * single user under the hidden container project. Safe to call repeatedly:
 * if the user already has any OA task under the container, this no-ops.
 */
export async function seedOATasksForUser(
  userId: number,
  actingAdminId: number,
): Promise<void> {
  const oaDeptId = await getOADepartmentId();
  const containerId = await getOAContainerProjectId();
  if (!oaDeptId || !containerId) return;

  const existing = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.assigneeId, userId),
        eq(tasksTable.departmentId, oaDeptId),
        eq(tasksTable.projectId, containerId),
      ),
    )
    .limit(1);

  if (existing.length > 0) return;

  const templates = await db
    .select()
    .from(taskTemplatesTable)
    .where(eq(taskTemplatesTable.departmentId, oaDeptId))
    .orderBy(taskTemplatesTable.sortOrder);

  if (templates.length === 0) return;

  await db.insert(tasksTable).values(
    templates.map((t) => ({
      title: t.title,
      status: "backlog",
      priority: "medium",
      projectId: containerId,
      departmentId: oaDeptId,
      assigneeId: userId,
      assignerId: actingAdminId,
      elapsedSeconds: 0,
      timerRunning: false,
    })),
  );
}
