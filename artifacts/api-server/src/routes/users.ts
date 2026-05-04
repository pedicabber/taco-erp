import { Router, type IRouter } from "express";
import { db, usersTable, departmentsTable, userDepartmentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { syncUserFromClerk, getOrCreateUser } from "../lib/userSync";
import { UpdateMeBody, UpdateMeResponse, ListUsersResponse, GetUserResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function buildUserProfile(
  user: typeof usersTable.$inferSelect,
  departmentName: string | null,
  departmentIds: number[] = [],
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

  res.set("Cache-Control", "no-store");
  res.json(buildUserProfile(user, departmentName, departmentIds));
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

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.departmentId !== undefined) updates.departmentId = parsed.data.departmentId;
  if (parsed.data.avatarUrl !== undefined) updates.avatarUrl = parsed.data.avatarUrl;

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id)).returning();

  let departmentName: string | null = null;
  if (updated.departmentId) {
    const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, updated.departmentId));
    departmentName = dept?.name ?? null;
  }

  const departmentIds = await getDeptIdsForUser(updated.id);

  res.json(UpdateMeResponse.parse(buildUserProfile(updated, departmentName, departmentIds)));
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

  res.json(
    users.map(u =>
      buildUserProfile(
        u,
        u.departmentId ? deptMap.get(u.departmentId) ?? null : null,
        userDeptsMap.get(u.id) ?? [],
      )
    )
  );
});

router.patch("/users/:userId", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const { role, departmentId, name, avatarUrl, departmentIds } = req.body as {
    role?: string;
    departmentId?: number | null;
    name?: string;
    avatarUrl?: string | null;
    departmentIds?: number[];
  };

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

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }

  if (departmentIds !== undefined) {
    await db.delete(userDepartmentsTable).where(eq(userDepartmentsTable.userId, id));
    if (departmentIds.length > 0) {
      await db.insert(userDepartmentsTable).values(
        departmentIds.map(dId => ({ userId: id, departmentId: dId }))
      );
    }
  }

  let departmentName: string | null = null;
  if (updated.departmentId) {
    const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, updated.departmentId));
    departmentName = dept?.name ?? null;
  }

  const finalDeptIds = await getDeptIdsForUser(id);

  res.json(buildUserProfile(updated, departmentName, finalDeptIds));
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

  res.json(GetUserResponse.parse(buildUserProfile(user, departmentName, departmentIds)));
});

export default router;
