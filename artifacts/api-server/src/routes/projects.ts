import { Router, type IRouter } from "express";
import multer from "multer";
import { parsePdfText } from "../lib/pdfParseAdapter";
import { db, projectsTable, departmentsTable, tasksTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
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
    address: p.address,
    contactName: p.contactName,
    contactPhone: p.contactPhone,
    contactEmail: p.contactEmail,
    totalPrice: p.totalPrice,
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
    const text = await parsePdfText(req.file.buffer);

    const company = extractLabel(text, ["Company", "Customer", "Client", "Bill To"]) ?? "";
    const projectId = extractQuoteNumber(text) ?? "";
    const address = extractAddress(text) ?? "";
    const contactName = extractLabel(text, ["Contact", "Attention", "Attn", "Prepared For"]) ?? "";
    const contactPhone = extractPhone(text) ?? "";
    const contactEmail = extractEmail(text) ?? "";
    const totalPrice = extractTotalPrice(text) ?? "";
    const description = extractDescription(text);
    const startDate = extractStartDate(text) ?? "";

    const result = {
      company,
      name: company ? company : "New Project",
      projectId,
      description,
      startDate,
      address,
      contactName,
      contactPhone,
      contactEmail,
      totalPrice,
    };

    res.json(ParsePdfResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to parse PDF");
    res.status(500).json({ error: "Failed to parse PDF" });
  }
});

function extractLabel(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*:?\\s*([^\\n\\r]{2,80})`, "i");
    const match = text.match(regex);
    if (match) {
      const value = match[1].trim().replace(/\s{2,}/g, " ");
      if (value.length > 1) return value;
    }
  }
  return null;
}

function extractQuoteNumber(text: string): string | null {
  // Match common quote/job number formats: "24-1084REVC", "24-1084", "Q-2024-001"
  const patterns = [
    /Quote\s*No\.?\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,20})/i,
    /Job\s*No\.?\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,20})/i,
    /Project\s*(?:No|ID|Number|#)\.?\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,20})/i,
    /Proposal\s*No\.?\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,20})/i,
    /RFQ\s*(?:No\.?)?\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,20})/i,
    // standalone pattern like "24-1084REVC" - year-number-revision
    /\b(\d{2}-\d{4}[A-Z]*\d*)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function extractAddress(text: string): string | null {
  const match = text.match(/Address\s*:?\s*([^\n\r]{5,120}(?:[\n\r]+[^\n\r]{5,80})?)/i);
  if (!match) return null;
  // Collapse multi-line address into single line
  const lines = match[1].split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 0);
  return lines.join(", ").replace(/,\s*,/g, ",").trim();
}

function extractPhone(text: string): string | null {
  const match = text.match(/(?:Phone|Tel|Telephone|Ph)\s*\.?\s*:?\s*([0-9\-\(\)\+\. ]{7,20})/i);
  if (match) return match[1].trim().replace(/\s+/g, " ");
  // fallback: any standalone phone number pattern near the header
  const fallback = text.slice(0, 1500).match(/\b(\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4})\b/);
  return fallback ? fallback[1].trim() : null;
}

function extractEmail(text: string): string | null {
  const labeled = text.match(/Email\s*:?\s*([^\s@]{1,40}@[^\s]{1,40})/i);
  if (labeled) return labeled[1].trim();
  // fallback: first email in document
  const fallback = text.match(/\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/);
  return fallback ? fallback[1].trim() : null;
}

function extractTotalPrice(text: string): string | null {
  // Match "TOTAL", "Grand Total", "Total Amount" followed by a dollar amount
  const match = text.match(/(?:Grand\s*)?Total(?:\s*Amount)?\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (match) {
    const amount = match[1].replace(/,/g, "");
    return `$${parseFloat(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return null;
}

function extractDescription(text: string): string {
  const match = text.match(/(?:Description|Scope|Subject)\s*:?\s*[\r\n]+([\s\S]+?)(?:Quote|Subtotal|Total|Terms|Payment|Page)/i);
  if (match) {
    const raw = match[1].trim();
    const lines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 2).slice(0, 4);
    return lines.join(" ").replace(/\s{2,}/g, " ").trim();
  }
  // fallback: grab a few meaningful lines after the header block
  const fallbackMatch = text.match(/(?:Anaheim|Assembly|Fabricat|Install|Supply)[^\n]{5,120}/i);
  return fallbackMatch ? fallbackMatch[0].trim() : "";
}

function extractStartDate(text: string): string | null {
  const patterns = [
    /Date\s*Issued\s*:?\s*([^\n\r]+)/i,
    /(?:Quote|Proposal|Bid)\s*Date\s*:?\s*([^\n\r]+)/i,
    /Date\s*:?\s*([A-Za-z]+ \d{1,2},?\s*\d{4})/i,
    /Date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = match[1].trim();
    const date = new Date(raw);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0];
    }
  }
  return null;
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

router.delete("/projects/:projectId", requireAdmin, async (req, res): Promise<void> => {
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
