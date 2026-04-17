import { Router, type IRouter } from "express";
import { db, usersTable, departmentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { syncUserFromClerk, getOrCreateUser } from "../lib/userSync";
import { UpdateMeBody, UpdateMeResponse, ListUsersResponse, GetUserResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function buildUserProfile(user: typeof usersTable.$inferSelect, departmentName: string | null) {
  return {
    id: user.id,
    clerkId: user.clerkId,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId,
    departmentName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
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

  res.set("Cache-Control", "no-store");
  res.json(buildUserProfile(user, departmentName));
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

  res.json(UpdateMeResponse.parse(buildUserProfile(updated, departmentName)));
});

router.get("/users", requireAuth, async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable);
  const deptIds = [...new Set(users.map(u => u.departmentId).filter(Boolean))] as number[];

  const depts = deptIds.length > 0
    ? await db.select().from(departmentsTable).where(inArray(departmentsTable.id, deptIds))
    : [];

  const deptMap = new Map(depts.map(d => [d.id, d.name]));

  res.json(ListUsersResponse.parse(users.map(u => buildUserProfile(u, u.departmentId ? deptMap.get(u.departmentId) ?? null : null))));
});

// Admin-only: update any user's role or department
router.patch("/users/:userId", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const { role, departmentId } = req.body as { role?: string; departmentId?: number | null };
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (role !== undefined) updates.role = role;
  if (departmentId !== undefined) updates.departmentId = departmentId;

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }

  let departmentName: string | null = null;
  if (updated.departmentId) {
    const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, updated.departmentId));
    departmentName = dept?.name ?? null;
  }
  res.json(buildUserProfile(updated, departmentName));
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

  res.json(GetUserResponse.parse(buildUserProfile(user, departmentName)));
});

export default router;
