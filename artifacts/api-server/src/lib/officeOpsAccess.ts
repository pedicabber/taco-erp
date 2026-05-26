import type { Response } from "express";
import { db, usersTable, userDepartmentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { syncUserFromClerk } from "./userSync";
import { getOADepartmentId } from "./officeAdmin";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";

/**
 * Pure check: does this DB user have access to the Office Ops workspace?
 *
 * True when the user is an admin OR is a member of the OFFICE/ADMIN
 * department (by either the legacy single `users.departmentId` column or
 * a row in `user_departments`).
 */
export async function userHasOfficeOpsAccess(
  user: typeof usersTable.$inferSelect,
): Promise<boolean> {
  if (user.role === "admin") return true;

  const oaDeptId = await getOADepartmentId();
  if (oaDeptId === null) return false;

  if (user.departmentId === oaDeptId) return true;

  const [membership] = await db
    .select({ d: userDepartmentsTable.departmentId })
    .from(userDepartmentsTable)
    .where(
      and(
        eq(userDepartmentsTable.userId, user.id),
        eq(userDepartmentsTable.departmentId, oaDeptId),
      ),
    )
    .limit(1);

  return !!membership;
}

/**
 * Gate for the Office Ops workspace.
 *
 * Returns the resolved DB user on success. On failure, writes the
 * appropriate status (401 unauthenticated / 403 forbidden) to `res` and
 * returns null; callers should `return` immediately on null.
 */
export async function requireOfficeOpsAccess(
  req: AuthenticatedRequest,
  res: Response,
): Promise<typeof usersTable.$inferSelect | null> {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  if (await userHasOfficeOpsAccess(user)) return user;

  res.status(403).json({ error: "Office Ops access denied" });
  return null;
}
