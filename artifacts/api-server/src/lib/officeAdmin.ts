import {
  db,
  projectsTable,
  departmentsTable,
  tasksTable,
  taskTemplatesTable,
  usersTable,
} from "@workspace/db";
import { and, eq, isNull, ne, or, type SQL } from "drizzle-orm";
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

let cachedContainerId: number | null = null;
let cachedOADeptId: number | null = null;

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
  if (cachedOADeptId !== null) return cachedOADeptId;
  const [d] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.name, OA_DEPT_NAME), isNull(departmentsTable.projectId)));
  cachedOADeptId = d?.id ?? null;
  return cachedOADeptId;
}

export async function getOAContainerProjectId(): Promise<number | null> {
  if (cachedContainerId !== null) return cachedContainerId;
  const [p] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.name, OA_CONTAINER_PROJECT_NAME));
  cachedContainerId = p?.id ?? null;
  return cachedContainerId;
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
  return or(ne(tasksTable.projectId, cid), eq(tasksTable.assigneeId, userId));
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
      cachedContainerId = existing.id;
      return;
    }

    const [admin] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));

    const [created] = await db
      .insert(projectsTable)
      .values({
        name: OA_CONTAINER_PROJECT_NAME,
        company: "Internal",
        projectId: "OA-INTERNAL",
        status: "active",
        createdById: admin?.id ?? 0,
      })
      .returning();
    cachedContainerId = created.id;
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
