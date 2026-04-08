import { Router, type IRouter } from "express";
import multer from "multer";
import { db, projectsTable, departmentsTable, tasksTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { syncUserFromClerk } from "../lib/userSync";
import {
  CreateProjectBody,
  GetProjectResponse,
  ListProjectsResponse,
  UpdateProjectBody,
  UpdateProjectResponse,
  GetProjectSummaryResponse,
  ParsePdfResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function buildProject(p: typeof projectsTable.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    company: p.company,
    projectId: p.projectId,
    description: p.description,
    startDate: p.startDate,
    status: p.status as "active" | "completed" | "on_hold" | "cancelled",
    createdById: p.createdById,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.get("/projects", requireAuth, async (_req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable).orderBy(projectsTable.createdAt);
  res.json(ListProjectsResponse.parse(projects.map(buildProject)));
});

router.post("/projects", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [project] = await db.insert(projectsTable).values({
    ...parsed.data,
    status: parsed.data.status ?? "active",
    createdById: user.id,
  }).returning();

  res.status(201).json(GetProjectResponse.parse(buildProject(project)));
});

router.get("/projects/parse-pdf", requireAuth, async (_req, res): Promise<void> => {
  res.status(405).json({ error: "Use POST" });
});

router.post("/projects/parse-pdf", requireAuth, upload.single("file"), async (req: AuthenticatedRequest, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
    const data = await pdfParse(req.file.buffer);
    const text = data.text;

    const company = extractField(text, "Company:") ?? "";
    const projectIdRaw = extractField(text, "Quote No.:") ?? "";
    const partNumber = extractPartNumber(text) ?? "";
    const description = extractDescription(text);
    const startDate = extractStartDate(text) ?? "";

    const result = {
      company,
      name: partNumber || "New Project",
      projectId: projectIdRaw,
      description,
      startDate,
    };

    res.json(ParsePdfResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to parse PDF");
    res.status(500).json({ error: "Failed to parse PDF" });
  }
});

function extractField(text: string, label: string): string | null {
  const regex = new RegExp(`${label}\\s*([^\\n]+)`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function extractPartNumber(text: string): string | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\d+\s+\w+-\w+/.test(line) || /CUSTOM-/.test(line)) {
      const parts = line.split(/\s+/);
      if (parts[1]) return parts[1];
    }
  }
  const match = text.match(/(?:CUSTOM-\w+)/);
  return match ? match[0] : null;
}

function extractDescription(text: string): string {
  const match = text.match(/(?:Description\s*[\r\n]+)?([\s\S]+?)(?:including the following options|Subtotal)/i);
  if (match) {
    const raw = match[1].replace(/\d+\s+[\w-]+\s+/g, "").trim();
    const lines = raw.split("\n").filter(l => l.trim()).slice(0, 3);
    return lines.join(" ").trim();
  }
  return "";
}

function extractStartDate(text: string): string | null {
  const match = text.match(/Date Issued:\s*([^\n]+)/i);
  if (!match) return null;
  const raw = match[1].trim();
  const date = new Date(raw);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split("T")[0];
  }
  return raw;
}

router.get("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(GetProjectResponse.parse(buildProject(project)));
});

router.patch("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db.update(projectsTable).set(parsed.data).where(eq(projectsTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(UpdateProjectResponse.parse(buildProject(updated)));
});

router.delete("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  res.sendStatus(204);
});

router.get("/projects/:projectId/summary", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.projectId, id));
  const depts = await db.select().from(departmentsTable).where(eq(departmentsTable.projectId, id));

  const statusCounts: Record<string, number> = {};
  const deptCounts: Record<number, number> = {};
  let overdueTasks = 0;
  const now = new Date();

  for (const task of tasks) {
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    if (task.departmentId) {
      deptCounts[task.departmentId] = (deptCounts[task.departmentId] ?? 0) + 1;
    }
    if (task.dueDate && new Date(task.dueDate) < now && task.status !== "complete") {
      overdueTasks++;
    }
  }

  const deptMap = new Map(depts.map(d => [d.id, d.name]));

  const summary = {
    projectId: id,
    totalTasks: tasks.length,
    tasksByStatus: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
    tasksByDepartment: Object.entries(deptCounts).map(([deptId, count]) => ({
      departmentId: Number(deptId),
      departmentName: deptMap.get(Number(deptId)) ?? "Unknown",
      count,
    })),
    overdueTasks,
  };

  res.json(GetProjectSummaryResponse.parse(summary));
});

export default router;
