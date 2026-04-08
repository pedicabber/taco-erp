import { Router, type IRouter } from "express";
import { db, departmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  CreateDepartmentBody,
  GetDepartmentResponse,
  ListDepartmentsResponse,
  UpdateDepartmentBody,
  UpdateDepartmentResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function buildDept(d: typeof departmentsTable.$inferSelect) {
  return {
    id: d.id,
    name: d.name,
    color: d.color,
    projectId: d.projectId,
    createdAt: d.createdAt.toISOString(),
  };
}

router.get("/departments", requireAuth, async (_req, res): Promise<void> => {
  const depts = await db.select().from(departmentsTable).orderBy(departmentsTable.projectId, departmentsTable.name);
  res.json(ListDepartmentsResponse.parse(depts.map(buildDept)));
});

router.post("/departments", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [dept] = await db.insert(departmentsTable).values(parsed.data).returning();
  res.status(201).json(GetDepartmentResponse.parse(buildDept(dept)));
});

router.get("/departments/:departmentId", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.departmentId) ? req.params.departmentId[0] : req.params.departmentId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid department ID" });
    return;
  }

  const [dept] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, id));
  if (!dept) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  res.json(GetDepartmentResponse.parse(buildDept(dept)));
});

router.patch("/departments/:departmentId", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.departmentId) ? req.params.departmentId[0] : req.params.departmentId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid department ID" });
    return;
  }

  const parsed = UpdateDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db.update(departmentsTable).set(parsed.data).where(eq(departmentsTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Department not found" });
    return;
  }

  res.json(UpdateDepartmentResponse.parse(buildDept(updated)));
});

router.delete("/departments/:departmentId", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.departmentId) ? req.params.departmentId[0] : req.params.departmentId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid department ID" });
    return;
  }

  await db.delete(departmentsTable).where(eq(departmentsTable.id, id));
  res.sendStatus(204);
});

export default router;
