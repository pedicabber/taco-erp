import { Router, type IRouter } from "express";
import { db, taskTemplatesTable, taskTemplateSubtasksTable, settingsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/task-templates", requireAuth, async (_req, res): Promise<void> => {
  const tasks = await db
    .select()
    .from(taskTemplatesTable)
    .orderBy(asc(taskTemplatesTable.sortOrder));

  const subtasks = await db
    .select()
    .from(taskTemplateSubtasksTable)
    .orderBy(asc(taskTemplateSubtasksTable.sortOrder));

  const result = tasks.map(t => ({
    ...t,
    subtasks: subtasks.filter(s => s.taskTemplateId === t.id),
  }));

  res.json(result);
});

router.post("/task-templates", requireAdmin, async (req, res): Promise<void> => {
  const { title } = req.body as { title: string };
  if (!title?.trim()) {
    res.status(400).json({ error: "Title is required" });
    return;
  }

  const existing = await db.select().from(taskTemplatesTable);
  const maxOrder = existing.reduce((m, t) => Math.max(m, t.sortOrder), -1);

  const [row] = await db.insert(taskTemplatesTable).values({
    title: title.trim(),
    sortOrder: maxOrder + 1,
  }).returning();

  res.status(201).json({ ...row, subtasks: [] });
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
  await db.delete(taskTemplateSubtasksTable).where(eq(taskTemplateSubtasksTable.taskTemplateId, id));
  await db.delete(taskTemplatesTable).where(eq(taskTemplatesTable.id, id));
  res.json({ ok: true });
});

router.put("/task-templates/order", requireAdmin, async (req, res): Promise<void> => {
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "ids must be an array" });
    return;
  }
  for (let i = 0; i < ids.length; i++) {
    await db.update(taskTemplatesTable).set({ sortOrder: i }).where(eq(taskTemplatesTable.id, ids[i]));
  }
  res.json({ ok: true });
});

router.post("/task-templates/:id/subtasks", requireAdmin, async (req, res): Promise<void> => {
  const taskTemplateId = parseInt(req.params.id, 10);
  const { title } = req.body as { title: string };
  if (!title?.trim()) {
    res.status(400).json({ error: "Title is required" });
    return;
  }

  const existing = await db
    .select()
    .from(taskTemplateSubtasksTable)
    .where(eq(taskTemplateSubtasksTable.taskTemplateId, taskTemplateId));
  const maxOrder = existing.reduce((m, s) => Math.max(m, s.sortOrder), -1);

  const [row] = await db.insert(taskTemplateSubtasksTable).values({
    taskTemplateId,
    title: title.trim(),
    sortOrder: maxOrder + 1,
  }).returning();

  res.status(201).json(row);
});

router.patch("/task-templates/:id/subtasks/:subId", requireAdmin, async (req, res): Promise<void> => {
  const subId = parseInt(req.params.subId, 10);
  const { title } = req.body as { title: string };
  if (!title?.trim()) {
    res.status(400).json({ error: "Title is required" });
    return;
  }

  const [updated] = await db
    .update(taskTemplateSubtasksTable)
    .set({ title: title.trim() })
    .where(eq(taskTemplateSubtasksTable.id, subId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

router.delete("/task-templates/:id/subtasks/:subId", requireAdmin, async (req, res): Promise<void> => {
  const subId = parseInt(req.params.subId, 10);
  await db.delete(taskTemplateSubtasksTable).where(eq(taskTemplateSubtasksTable.id, subId));
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
