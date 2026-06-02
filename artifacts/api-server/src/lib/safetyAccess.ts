import type { Response } from "express";
import { db, usersTable, userDepartmentsTable, departmentsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { syncUserFromClerk } from "./userSync";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";

/**
 * The department whose members (alongside admins) may create and manage LOTO
 * records. Viewing LOTO records is company-wide; only mutations are gated.
 */
export const SAFETY_DEPT_NAME = "SAFETY";

/** Resolve the SAFETY department id (a top-level dept with no project). */
export async function getSafetyDepartmentId(): Promise<number | null> {
  const [d] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.name, SAFETY_DEPT_NAME), isNull(departmentsTable.projectId)));
  return d?.id ?? null;
}

/**
 * Pure check: may this DB user create/manage Safety (LOTO) records?
 *
 * True when the user is an admin OR is a member of the SAFETY department (by
 * either the legacy single `users.departmentId` column or a row in
 * `user_departments`). If no SAFETY department exists yet, only admins qualify.
 */
export async function userHasSafetyAccess(
  user: typeof usersTable.$inferSelect,
): Promise<boolean> {
  if (user.role === "admin") return true;

  const safetyDeptId = await getSafetyDepartmentId();
  if (safetyDeptId === null) return false;

  if (user.departmentId === safetyDeptId) return true;

  const [membership] = await db
    .select({ d: userDepartmentsTable.departmentId })
    .from(userDepartmentsTable)
    .where(
      and(
        eq(userDepartmentsTable.userId, user.id),
        eq(userDepartmentsTable.departmentId, safetyDeptId),
      ),
    )
    .limit(1);

  return !!membership;
}

/**
 * Gate for Safety (LOTO) mutations.
 *
 * Returns the resolved DB user on success. On failure, writes the appropriate
 * status (401 unauthenticated / 403 forbidden) to `res` and returns null;
 * callers should `return` immediately on null.
 */
export async function requireSafetyAccess(
  req: AuthenticatedRequest,
  res: Response,
): Promise<typeof usersTable.$inferSelect | null> {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  if (await userHasSafetyAccess(user)) return user;

  res.status(403).json({ error: "Safety access denied" });
  return null;
}
