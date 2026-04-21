import { Router, type IRouter } from "express";
import { db, departmentsTable } from "@workspace/db";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { DEPARTMENT_TASKS } from "../templateTasks";
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

router.get("/departments", requireAuth, async (req, res): Promise<void> => {
  const { global: globalParam, projectId: projectIdParam } = req.query as Record<string, string | undefined>;

  let depts;
  if (globalParam === "true") {
    depts = await db
      .select()
      .from(departmentsTable)
      .where(
        and(
          isNull(departmentsTable.projectId),
          inArray(
            departmentsTable.name,
            DEPARTMENT_TASKS.map(d => d.dept),
          ),
        ),
      )
      .orderBy(departmentsTable.name);
  } else if (projectIdParam !== undefined) {
    const pid = parseInt(projectIdParam, 10);
    if (isNaN(pid)) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }
    depts = await db.select().from(departmentsTable).where(eq(departmentsTable.projectId, pid)).orderBy(departmentsTable.name);
  } else {
    depts = await db.select().from(departmentsTable).orderBy(departmentsTable.name);
  }

  res.json(ListDepartmentsResponse.parse(depts.map(buildDept)));
});

router.post("/departments", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateDepartmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [dept] = await db.insert(departmentsTable).values({
    name: parsed.data.name,
    color: parsed.data.color ?? null,
    projectId: parsed.data.projectId ?? null,
  }).returning();
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

router.patch("/departments/:departmentId", requireAdmin, async (req, res): Promise<void> => {
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

router.delete("/departments/:departmentId", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.departmentId) ? req.params.departmentId[0] : req.params.departmentId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid department ID" });
    return;
  }

  await db.delete(departmentsTable).where(eq(departmentsTable.id, id));
  res.sendStatus(204);
});

export default router;
