import { Router, type IRouter } from "express";
import { db, taskTemplatesTable, settingsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/task-templates", requireAuth, async (_req, res): Promise<void> => {
  const tasks = await db
    .select()
    .from(taskTemplatesTable)
    .orderBy(asc(taskTemplatesTable.sortOrder));
  res.json(tasks);
});

router.post("/task-templates", requireAdmin, async (req, res): Promise<void> => {
  const { title, departmentId } = req.body as { title: string; departmentId: number };
  if (!title?.trim()) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  if (!departmentId) {
    res.status(400).json({ error: "departmentId is required" });
    return;
  }

  const existing = await db.select().from(taskTemplatesTable);
  const maxOrder = existing.reduce((m, t) => Math.max(m, t.sortOrder), -1);

  const [row] = await db.insert(taskTemplatesTable).values({
    title: title.trim(),
    departmentId,
    sortOrder: maxOrder + 1,
  }).returning();

  res.status(201).json(row);
});

router.patch("/task-templates/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { title } = req.body as { title: string };
  if (!title?.trim()) {
    res.status(400).json({ error: "Title is required" });
    return;
  }

  const [updated] = await db
    .update(taskTemplatesTable)
    .set({ title: title.trim() })
    .where(eq(taskTemplatesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

router.delete("/task-templates/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(taskTemplatesTable).where(eq(taskTemplatesTable.id, id));
  res.json({ ok: true });
});

router.get("/settings", requireAuth, async (_req, res): Promise<void> => {
  const settings = await db.select().from(settingsTable);
  const result: Record<string, string> = {};
  for (const s of settings) result[s.key] = s.value;
  res.json(result);
});

router.put("/settings/:key", requireAdmin, async (req, res): Promise<void> => {
  const { key } = req.params;
  const { value } = req.body as { value: string };
  if (value === undefined) {
    res.status(400).json({ error: "value is required" });
    return;
  }

  await db
    .insert(settingsTable)
    .values({ key, value: String(value) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: String(value) } });

  res.json({ key, value });
});

export default router;
