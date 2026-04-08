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

    const company = extractCompany(text) ?? "";
    const projectId = extractQuoteNumber(text) ?? "";
    const address = extractAddress(text) ?? "";
    const contactName = extractContact(text) ?? "";
    const contactPhone = extractPhone(text) ?? "";
    const contactEmail = extractEmail(text) ?? "";
    const totalPrice = extractTotalPrice(text) ?? "";
    const { name: partNumber, description } = extractPartNumberAndDescription(text);
    const startDate = extractStartDate(text) ?? "";

    const result = {
      company,
      name: partNumber || company || "New Project",
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
  // Row format: "Company : American Woodmark Contact : ..."
  const between = text.match(/Company\s*:\s*(.+?)\s+Contact\s*:/i);
  if (between) return between[1].trim();
  // Fallback: value after Company label until end-of-line or next label
  const plain = text.match(/Company\s*:\s*([^\n\r:]{2,60})/i);
  if (plain) return plain[1].trim();
  // Generic labels
  for (const label of ["Customer", "Client", "Bill To"]) {
    const m = text.match(new RegExp(`${label}\\s*:\\s*([^\\n\\r:]{2,60})`, "i"));
    if (m) return m[1].trim();
  }
  return null;
}

function extractContact(text: string): string | null {
  // Row format: "... Contact : Mr. Giancarlo Touzard"
  const m = text.match(/Contact\s*:\s*(.+?)(?:\n|$)/im);
  if (m) return m[1].trim();
  for (const label of ["Attention", "Attn"]) {
    const alt = text.match(new RegExp(`${label}\\s*:\\s*([^\\n\\r:]{2,60})`, "i"));
    if (alt) return alt[1].trim();
  }
  return null;
}

function extractQuoteNumber(text: string): string | null {
  // Row format: "Quote No.: 2 4 - 10 84 REV C" (chars may be spaced out)
  // Use [ \t] instead of \s to avoid matching across line breaks
  const labeled = text.match(/(?:Quote|Job|Proposal|RFQ)\s*No\.?\s*:?\s*([A-Z0-9][A-Z0-9 \t\-]{3,30})/i);
  if (labeled) {
    const collapsed = collapseId(labeled[1]);
    if (collapsed.length >= 3) return collapsed;
  }
  // Fallback: project/reference number pattern
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
  // Row 1: "Address : 400 E Orangethorpe Ave . Phone : 714-578-3791"
  const streetMatch = text.match(/Address\s*:\s*(.+?)\s+Phone\s*:/i);
  let street = streetMatch ? streetMatch[1].trim().replace(/\s+\./g, ".") : null;

  // Row 2 (continuation): text before "Email :"
  const cityMatch = text.match(/([A-Za-z][\w\s,]+CA\s+[\d\s]+)\s+Email\s*:/i)
    ?? text.match(/([A-Za-z][\w\s,]+\d{5})\s+Email\s*:/i);
  let city = cityMatch ? collapseDigits(cityMatch[1].trim().replace(/\s*,\s*/g, ", ")) : null;

  if (street && city) return `${street}, ${city}`;
  if (street) return street;

  // Generic fallback
  const generic = text.match(/Address\s*:\s*([^\n\r]{5,120})/i);
  return generic ? generic[1].trim() : null;
}

function extractPhone(text: string): string | null {
  // The address row is: "Address : 400 E Orangethorpe Ave . Phone : 714 - 578 - 3791"
  // Match Phone that appears on the SAME line as "Address :" to avoid vendor header phones
  const onAddressLine = text.match(/Address\s*:.+?Phone\s*:\s*([\d\s\-\(\)\+\.]{7,25})/i);
  if (onAddressLine) return collapseId(onAddressLine[1]);
  // Fallback: customer contact phone (not vendor header)
  const m = text.match(/(?:Customer|Client|Contact)\s+Phone\s*:\s*([\d\s\-\(\)\+\.]{7,25})/i);
  if (m) return collapseId(m[1]);
  return null;
}

function extractEmail(text: string): string | null {
  // "Email : gtouzard@Woodmark.com"
  const labeled = text.match(/Email\s*:\s*([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/i);
  if (labeled) return labeled[1].trim();
  // Fallback: any email in doc
  const fallback = text.match(/\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/);
  return fallback ? fallback[1].trim() : null;
}

function extractPartNumberAndDescription(text: string): { name: string; description: string } {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match line starting with qty number + all-caps word + "-"
    const qtyMatch = line.match(/^\s*\d+\s+([A-Z][A-Z0-9]+)\s*-\s*/);
    if (!qtyMatch) continue;

    const partStart = qtyMatch[1];
    const afterPartStart = line.slice(qtyMatch.index! + qtyMatch[0].length);

    // Check if continuation of part number on same line (e.g., "CUSTOM - INTEGRATION Desc...")
    const sameLineCont = afterPartStart.match(/^([A-Z][A-Z0-9]+)\s+[A-Z][a-z]/);
    let partNumber: string;
    let descText: string;

    if (sameLineCont) {
      partNumber = `${partStart}-${sameLineCont[1]}`;
      descText = afterPartStart.slice(sameLineCont[0].length - 1);
    } else {
      // Part number wraps to next line
      partNumber = partStart + "-";
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : "";
      const contMatch = nextLine.match(/^([A-Z][A-Z0-9]+)\s/);
      if (contMatch) partNumber += contMatch[1];
      descText = afterPartStart;
    }

    // Extract description: stop at "including"
    const inclIdx = descText.toLowerCase().indexOf("including");
    const rawDesc = inclIdx > 0 ? descText.slice(0, inclIdx) : descText;
    // Strip trailing price ($...)
    const description = rawDesc.replace(/\$[\s\d,]+$/, "").trim();

    return { name: partNumber, description };
  }
  return { name: "", description: "" };
}

function extractTotalPrice(text: string): string | null {
  // "TOTAL: $ 1, 213 , 8 0 8" — TOTAL line (use exact "TOTAL:" not "Subtotal")
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
  // "Date Issued: De cember 11, 20 2 4"
  // Use [ \t] (not \s) to avoid capturing across line breaks
  const patterns = [
    /Date\s+Issued\s*:\s*([A-Za-z ,0-9]{8,30})/i,
    /(?:Quote|Proposal|Bid)\s*Date\s*:\s*([A-Za-z ,0-9]{8,30})/i,
    /Date\s*:\s*([A-Za-z ,0-9]{8,30})/i,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (!m) continue;
    let raw = m[1].trim();
    // Fix split words ("De cember" → "December") and split digits
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
