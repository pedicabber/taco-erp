import { Router, type IRouter } from "express";
import { db, usersTable, departmentsTable, userDepartmentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { syncUserFromClerk, getOrCreateUser } from "../lib/userSync";
import { UpdateMeBody, UpdateMeResponse, ListUsersResponse, GetUserResponse } from "@workspace/api-zod";
import { getOADepartmentId, seedOATasksForUser } from "../lib/officeAdmin";
import { userHasOfficeOpsAccess } from "../lib/officeOpsAccess";
import { userHasSafetyAccess } from "../lib/safetyAccess";

const router: IRouter = Router();

/**
 * Avatar URLs may be either:
 *   - empty/null (cleared)
 *   - a path produced by our object storage avatar upload flow, which always
 *     contains "/storage/objects/uploads/avatars/" regardless of any artifact
 *     base-path prefix.
 * Anything else is rejected to prevent users pointing avatarUrl at arbitrary
 * private objects and bypassing the storage serve authorization.
 */
function isAllowedAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return url.includes("/storage/objects/uploads/avatars/");
}

function buildUserProfile(
  user: typeof usersTable.$inferSelect,
  departmentName: string | null,
  departmentIds: number[] = [],
  officeOpsAccess: boolean = false,
  safetyAccess: boolean = false,
) {
  return {
    id: user.id,
    clerkId: user.clerkId,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId,
    departmentName,
    departmentIds,
    officeOpsAccess,
    safetyAccess,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}

async function getDeptIdsForUser(userId: number): Promise<number[]> {
  const rows = await db
    .select({ departmentId: userDepartmentsTable.departmentId })
    .from(userDepartmentsTable)
    .where(eq(userDepartmentsTable.userId, userId));
  return rows.map(r => r.departmentId);
}

router.get("/users/me", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let departmentName: string | null = null;
  if (user.departmentId) {
    const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId));
    departmentName = dept?.name ?? null;
  }

  const departmentIds = await getDeptIdsForUser(user.id);
  const officeOpsAccess = await userHasOfficeOpsAccess(user);
  const safetyAccess = await userHasSafetyAccess(user);

  res.set("Cache-Control", "no-store");
  res.json(buildUserProfile(user, departmentName, departmentIds, officeOpsAccess, safetyAccess));
});

router.patch("/users/me", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.avatarUrl !== undefined && !isAllowedAvatarUrl(parsed.data.avatarUrl)) {
    res.status(400).json({ error: "Invalid avatar URL." });
    return;
  }

  // Self-service department changes are not allowed: department membership
  // grants access to scoped features (e.g. Office Ops via OFFICE/ADMIN), so
  // only admins may set department via PATCH /users/:id. Reject any attempt
  // here to prevent privilege escalation through profile editing.
  if (parsed.data.departmentId !== undefined && parsed.data.departmentId !== user.departmentId) {
    res.status(403).json({ error: "Department changes are admin-only." });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.avatarUrl !== undefined) updates.avatarUrl = parsed.data.avatarUrl;

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id)).returning();

  let departmentName: string | null = null;
  if (updated.departmentId) {
    const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, updated.departmentId));
    departmentName = dept?.name ?? null;
  }

  const departmentIds = await getDeptIdsForUser(updated.id);
  const officeOpsAccess = await userHasOfficeOpsAccess(updated);
  const safetyAccess = await userHasSafetyAccess(updated);

  res.json(UpdateMeResponse.parse(buildUserProfile(updated, departmentName, departmentIds, officeOpsAccess, safetyAccess)));
});

router.get("/users", requireAuth, async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable);

  const deptIds = [...new Set(users.map(u => u.departmentId).filter(Boolean))] as number[];
  const depts = deptIds.length > 0
    ? await db.select().from(departmentsTable).where(inArray(departmentsTable.id, deptIds))
    : [];
  const deptMap = new Map(depts.map(d => [d.id, d.name]));

  const userIds = users.map(u => u.id);
  const allUserDepts = userIds.length > 0
    ? await db.select().from(userDepartmentsTable).where(inArray(userDepartmentsTable.userId, userIds))
    : [];
  const userDeptsMap = new Map<number, number[]>();
  for (const row of allUserDepts) {
    if (!userDeptsMap.has(row.userId)) userDeptsMap.set(row.userId, []);
    userDeptsMap.get(row.userId)!.push(row.departmentId);
  }

  const oaDeptId = await getOADepartmentId();
  const isOA = (u: typeof usersTable.$inferSelect): boolean => {
    if (u.role === "admin") return true;
    if (oaDeptId === null) return false;
    if (u.departmentId === oaDeptId) return true;
    return (userDeptsMap.get(u.id) ?? []).includes(oaDeptId);
  };

  // Safety access is company-wide: every authenticated user (Admin or Member)
  // may open and use the LOTO module. See lib/safetyAccess.ts.
  const isSafety = (_u: typeof usersTable.$inferSelect): boolean => true;

  res.json(
    users.map(u =>
      buildUserProfile(
        u,
        u.departmentId ? deptMap.get(u.departmentId) ?? null : null,
        userDeptsMap.get(u.id) ?? [],
        isOA(u),
        isSafety(u),
      )
    )
  );
});

router.patch("/users/:userId", requireAdmin, async (req: AuthenticatedRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const actingUser = await syncUserFromClerk(req);

  const { role, departmentId, name, avatarUrl, departmentIds } = req.body as {
    role?: string;
    departmentId?: number | null;
    name?: string;
    avatarUrl?: string | null;
    departmentIds?: number[];
  };

  if (avatarUrl !== undefined && !isAllowedAvatarUrl(avatarUrl)) {
    res.status(400).json({ error: "Invalid avatar URL." });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (role !== undefined) updates.role = role;
  if (name !== undefined) updates.name = name;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

  if (departmentIds !== undefined) {
    updates.departmentId = departmentIds.length > 0 ? departmentIds[0] : null;
  } else if (departmentId !== undefined) {
    updates.departmentId = departmentId;
  }

  if (Object.keys(updates).length === 0 && departmentIds === undefined) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  // Capture prior OA membership BEFORE writing user_departments so we only
  // seed on a strict false→true transition (and not on every PATCH that
  // happens to include OA in the dept list).
  const oaDeptId = await getOADepartmentId();
  const wasInOA = oaDeptId !== null
    ? (await getDeptIdsForUser(id)).includes(oaDeptId)
    : false;

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }

  if (departmentIds !== undefined) {
    await db.delete(userDepartmentsTable).where(eq(userDepartmentsTable.userId, id));
    if (departmentIds.length > 0) {
      await db.insert(userDepartmentsTable).values(
        departmentIds.map(dId => ({ userId: id, departmentId: dId }))
      );
    }

    // Seed Office/Admin tasks only on a strict not-in-OA → in-OA transition.
    // The seed is also idempotent as a defensive backstop, so an extra call
    // here can never duplicate rows — but transition-gating keeps semantics
    // clean and avoids unrelated PATCH calls re-running the work.
    const nowInOA = oaDeptId !== null && departmentIds.includes(oaDeptId);
    if (oaDeptId !== null && nowInOA && !wasInOA) {
      await seedOATasksForUser(id, actingUser?.id ?? updated.id);
    }
  }

  let departmentName: string | null = null;
  if (updated.departmentId) {
    const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, updated.departmentId));
    departmentName = dept?.name ?? null;
  }

  const finalDeptIds = await getDeptIdsForUser(id);
  const officeOpsAccess = await userHasOfficeOpsAccess(updated);
  const safetyAccess = await userHasSafetyAccess(updated);

  res.json(buildUserProfile(updated, departmentName, finalDeptIds, officeOpsAccess, safetyAccess));
});

router.delete("/users/:userId", requireAdmin, async (req: AuthenticatedRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const requestingUser = await syncUserFromClerk(req);
  if (requestingUser && requestingUser.id === id) {
    res.status(403).json({ error: "You cannot delete your own account." });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  await db.delete(userDepartmentsTable).where(eq(userDepartmentsTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));

  res.status(204).end();
});

router.get("/users/:userId", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  let departmentName: string | null = null;
  if (user.departmentId) {
    const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, user.departmentId));
    departmentName = dept?.name ?? null;
  }

  const departmentIds = await getDeptIdsForUser(id);
  const officeOpsAccess = await userHasOfficeOpsAccess(user);
  const safetyAccess = await userHasSafetyAccess(user);

  res.json(GetUserResponse.parse(buildUserProfile(user, departmentName, departmentIds, officeOpsAccess, safetyAccess)));
});

export default router;
