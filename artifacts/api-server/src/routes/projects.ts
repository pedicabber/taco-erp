import { Router, type IRouter } from "express";
import multer from "multer";
import { parsePdfText } from "../lib/pdfParseAdapter";
import { db, projectsTable, departmentsTable, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
    fullDescription: p.fullDescription,
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

  const { parsedTasks, ...projectData } = parsed.data;

  const [project] = await db.insert(projectsTable).values({
    ...projectData,
    status: projectData.status ?? "active",
    createdById: user.id,
  }).returning();

  // Auto-create tasks from parsed bullet points with "new_tasks" status
  if (parsedTasks && parsedTasks.length > 0) {
    const todayIso = new Date().toISOString().split("T")[0];
    for (const task of parsedTasks) {
      await db.insert(tasksTable).values({
        title: task.title,
        description: task.description ?? null,
        status: "new_tasks",
        priority: "medium",
        projectId: project.id,
        assignerId: user.id,
        startDate: todayIso,
        elapsedSeconds: 0,
        timerRunning: false,
      });
    }
  }

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

    const company = extractCompany(text) ?? "";
    const projectId = extractQuoteNumber(text) ?? "";
    const address = extractAddress(text) ?? "";
    const contactName = extractContact(text) ?? "";
    const contactPhone = extractPhone(text) ?? "";
    const contactEmail = extractEmail(text) ?? "";
    const totalPrice = extractTotalPrice(text) ?? "";
    const { name: partNumber, description, fullDescription } = extractPartNumberAndDescription(text);
    const startDate = extractStartDate(text) ?? "";
    const parsedTasks = parseBulletPoints(fullDescription);

    const result = {
      company,
      name: partNumber || company || "New Project",
      projectId,
      description,
      fullDescription,
      startDate,
      address,
      contactName,
      contactPhone,
      contactEmail,
      totalPrice,
      parsedTasks,
    };

    res.json(ParsePdfResponse.parse(result));
  } catch (err) {
    req.log.error({ err }, "Failed to parse PDF");
    res.status(500).json({ error: "Failed to parse PDF" });
  }
});

// Remove internal spaces from a spaced-out ID or number (e.g., "2 4 - 10 84 REV C" → "24-1084REVC")
function collapseId(s: string): string {
  return s.replace(/\s*-\s*/g, "-").replace(/\s+/g, "").trim();
}

// Collapse spaces within digits (multiple passes), e.g. "1, 213 ,808" → "1,213,808"
function collapseDigits(s: string): string {
  let prev = s;
  for (let i = 0; i < 5; i++) {
    const next = prev
      .replace(/(\d)\s+(\d)/g, "$1$2")
      .replace(/,\s+(\d)/g, ",$1")
      .replace(/\$\s+/g, "$");
    if (next === prev) break;
    prev = next;
  }
  return prev.trim();
}

// Fix split words e.g. "De cember" → "December"
function fixSplitWords(s: string): string {
  return s.replace(/\b([A-Z][a-z]{1,3})\s+([a-z]{2,})\b/g, "$1$2");
}

function extractCompany(text: string): string | null {
  const between = text.match(/Company\s*:\s*(.+?)\s+Contact\s*:/i);
  if (between) return between[1].trim();
  const plain = text.match(/Company\s*:\s*([^\n\r:]{2,60})/i);
  if (plain) return plain[1].trim();
  for (const label of ["Customer", "Client", "Bill To"]) {
    const m = text.match(new RegExp(`${label}\\s*:\\s*([^\\n\\r:]{2,60})`, "i"));
    if (m) return m[1].trim();
  }
  return null;
}

function extractContact(text: string): string | null {
  const m = text.match(/Contact\s*:\s*(.+?)(?:\n|$)/im);
  if (m) return m[1].trim();
  for (const label of ["Attention", "Attn"]) {
    const alt = text.match(new RegExp(`${label}\\s*:\\s*([^\\n\\r:]{2,60})`, "i"));
    if (alt) return alt[1].trim();
  }
  return null;
}

function extractQuoteNumber(text: string): string | null {
  const labeled = text.match(/(?:Quote|Job|Proposal|RFQ)\s*No\.?\s*:?\s*([A-Z0-9][A-Z0-9 \t\-]{3,30})/i);
  if (labeled) {
    const collapsed = collapseId(labeled[1]);
    if (collapsed.length >= 3) return collapsed;
  }
  for (const pat of [
    /Project\s*(?:No|ID|Number|#)\.?\s*:?\s*([A-Z0-9][A-Z0-9\s\-]{3,20})/i,
    /\b(\d{2}-\d{4}[A-Z]+\d*)\b/,
  ]) {
    const m = text.match(pat);
    if (m) return collapseId(m[1]);
  }
  return null;
}

function extractAddress(text: string): string | null {
  const streetMatch = text.match(/Address\s*:\s*(.+?)\s+Phone\s*:/i);
  let street = streetMatch ? streetMatch[1].trim().replace(/\s+\./g, ".") : null;

  const cityMatch = text.match(/([A-Za-z][\w\s,]+CA\s+[\d\s]+)\s+Email\s*:/i)
    ?? text.match(/([A-Za-z][\w\s,]+\d{5})\s+Email\s*:/i);
  let city = cityMatch ? collapseDigits(cityMatch[1].trim().replace(/\s*,\s*/g, ", ")) : null;

  if (street && city) return `${street}, ${city}`;
  if (street) return street;

  const generic = text.match(/Address\s*:\s*([^\n\r]{5,120})/i);
  return generic ? generic[1].trim() : null;
}

function extractPhone(text: string): string | null {
  const onAddressLine = text.match(/Address\s*:.+?Phone\s*:\s*([\d\s\-\(\)\+\.]{7,25})/i);
  if (onAddressLine) return collapseId(onAddressLine[1]);
  const m = text.match(/(?:Customer|Client|Contact)\s+Phone\s*:\s*([\d\s\-\(\)\+\.]{7,25})/i);
  if (m) return collapseId(m[1]);
  return null;
}

function extractEmail(text: string): string | null {
  const labeled = text.match(/Email\s*:\s*([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/i);
  if (labeled) return labeled[1].trim();
  const fallback = text.match(/\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/);
  return fallback ? fallback[1].trim() : null;
}

function extractPartNumberAndDescription(text: string): { name: string; description: string; fullDescription: string } {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const qtyMatch = line.match(/^\s*\d+\s+([A-Z][A-Z0-9]+)\s*-\s*/);
    if (!qtyMatch) continue;

    const partStart = qtyMatch[1];
    const afterPartStart = line.slice(qtyMatch.index! + qtyMatch[0].length);

    const sameLineCont = afterPartStart.match(/^([A-Z][A-Z0-9]+)\s+[A-Z][a-z]/);
    let partNumber: string;
    let descText: string;

    if (sameLineCont) {
      partNumber = `${partStart}-${sameLineCont[1]}`;
      descText = afterPartStart.slice(sameLineCont[0].length - 1);
    } else {
      partNumber = partStart + "-";
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : "";
      const contMatch = nextLine.match(/^([A-Z][A-Z0-9]+)\s/);
      if (contMatch) partNumber += contMatch[1];
      descText = afterPartStart;
    }

    // Find "including" split point
    const inclIdx = descText.toLowerCase().indexOf("including");

    // Brief description = everything before "including..."
    const rawDesc = inclIdx > 0 ? descText.slice(0, inclIdx) : descText;
    const description = rawDesc.replace(/\$[\s\d,]+$/, "").trim();

    // Full description = collect bullet point lines that follow the description line
    // Look at all lines after the current one until we hit a non-bullet line (price, total, etc.)
    const bulletLines: string[] = [];
    const bulletPattern = /^\s*[•\u2022\u25CF\u2023\u2043\-]\s+.+|^\s*o\s+.+/;
    const subBulletPattern = /^\s*[o○◦]\s+.+/;
    const stopPattern = /^\s*\$|subtotal|total\s*:/i;

    // The "following options:" part might be on the same line or continue on next lines
    // Collect all subsequent lines that look like bullet content
    for (let j = i + 1; j < lines.length; j++) {
      const bline = lines[j];
      if (stopPattern.test(bline)) break;
      // Collect the line as part of full description regardless (raw format preserved)
      if (bline.trim().length > 0) {
        bulletLines.push(bline.trim());
      }
    }

    const fullDescription = bulletLines.join("\n");

    return { name: partNumber, description, fullDescription };
  }
  return { name: "", description: "", fullDescription: "" };
}

interface ParsedTask {
  title: string;
  description: string;
}

function parseBulletPoints(fullDescription: string): ParsedTask[] {
  if (!fullDescription.trim()) return [];

  const tasks: ParsedTask[] = [];
  const lines = fullDescription.split("\n");

  // Patterns for main bullets (solid): •, *, -, •, or similar
  // Patterns for sub-bullets (hollow): o followed by space, ○, ◦, o
  const mainBulletPattern = /^[•\u2022\u25CF\u2023*]\s+(.+)/;
  const subBulletPattern = /^[o○◦\u25CB\u25E6]\s+(.+)/i;

  let currentTask: ParsedTask | null = null;
  const subDescLines: string[] = [];

  function flushCurrent() {
    if (currentTask) {
      if (subDescLines.length > 0) {
        currentTask.description = subDescLines.join("\n");
      }
      tasks.push({ ...currentTask });
      subDescLines.length = 0;
    }
    currentTask = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const mainMatch = line.match(mainBulletPattern);
    if (mainMatch) {
      flushCurrent();
      currentTask = { title: mainMatch[1].trim(), description: "" };
      continue;
    }

    const subMatch = line.match(subBulletPattern);
    if (subMatch && currentTask) {
      subDescLines.push(subMatch[1].trim());
      continue;
    }

    // Lines that are part of a multi-line main bullet or continued text
    if (currentTask && !mainMatch && !subMatch) {
      // This could be a continuation of the previous bullet title or just extra text
      // Only append if it doesn't look like a standalone section header
      if (!/^\d+\s+[A-Z]/.test(line) && !/^(subtotal|total)/i.test(line)) {
        subDescLines.push(line);
      }
    }
  }

  flushCurrent();
  return tasks;
}

function extractTotalPrice(text: string): string | null {
  const m = text.match(/\bTOTAL\s*:\s*\$?\s*([\d\s,]+)/i);
  if (m) {
    const clean = collapseDigits(m[1].replace(/\s/g, ""));
    const num = parseFloat(clean.replace(/,/g, ""));
    if (!isNaN(num)) {
      return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }
  return null;
}

function extractStartDate(text: string): string | null {
  const patterns = [
    /Date\s+Issued\s*:\s*([A-Za-z ,0-9]{8,30})/i,
    /(?:Quote|Proposal|Bid)\s*Date\s*:\s*([A-Za-z ,0-9]{8,30})/i,
    /Date\s*:\s*([A-Za-z ,0-9]{8,30})/i,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (!m) continue;
    let raw = m[1].trim();
    raw = fixSplitWords(raw);
    raw = collapseDigits(raw);
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
