import { Router, type IRouter } from "express";
import multer from "multer";
import { parsePdfText } from "../lib/pdfParseAdapter";
import { db, projectsTable, departmentsTable, tasksTable, taskAttachmentsTable, taskRelationsTable, projectAttachmentsTable, usersTable, settingsTable, inventoryAllocationsTable, taskTemplatesTable } from "@workspace/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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
  RescheduleProjectBody,
} from "@workspace/api-zod";
import {
  excludeOAContainerProject,
  getOADepartmentId,
  rejectIfHiddenProject,
} from "../lib/officeAdmin";
import { engineeringChangeOrdersTable } from "@workspace/db";
import { centsToDollars, parseMoneyToCents } from "../lib/money";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function parseProjectAttachmentBody(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const data = body as Record<string, unknown>;
  if (typeof data.fileName !== "string" || typeof data.objectPath !== "string") return null;
  return {
    fileName: data.fileName,
    objectPath: data.objectPath,
    fileSize: typeof data.fileSize === "number" ? data.fileSize : null,
    mimeType: typeof data.mimeType === "string" ? data.mimeType : null,
    isPinned: typeof data.isPinned === "boolean" ? data.isPinned : false,
  };
}

// ─── Phase scheduling constants (single source of truth) ──────────────────────
// Engineering occupies the first 25% of the active lead time; Manufacturing
// the next 30% (i.e. ends at 55%). Manual edits to individual tasks are
// always preserved.
export const ENGINEERING_PHASE_PCT = 0.25;
export const MANUFACTURING_PHASE_PCT = 0.30;
const ENG_END = ENGINEERING_PHASE_PCT;                          // 0.25
const MFG_START = ENGINEERING_PHASE_PCT;                        // 0.25
const MFG_END = ENGINEERING_PHASE_PCT + MANUFACTURING_PHASE_PCT; // 0.55

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addLeadTimePercent(start: Date, leadMs: number, percent: number): Date {
  return new Date(start.getTime() + Math.round(leadMs * percent));
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

type PhaseWindow = { startDate: string | null; endDate: string | null; weeks: number | null };

// Compute Engineering + Manufacturing phase windows from active dates.
// Returns nulls when dates are missing or invalid — never throws.
export function computePhaseWindows(
  activeStartDate: string | null | undefined,
  activeDeliveryDate: string | null | undefined,
): { engineering: PhaseWindow; manufacturing: PhaseWindow } {
  const start = parseDateOnly(activeStartDate);
  const delivery = parseDateOnly(activeDeliveryDate);
  const empty: PhaseWindow = { startDate: null, endDate: null, weeks: null };
  if (!start || !delivery || delivery.getTime() <= start.getTime()) {
    return { engineering: empty, manufacturing: empty };
  }
  const leadMs = delivery.getTime() - start.getTime();
  const engEnd = addLeadTimePercent(start, leadMs, ENG_END);
  const mfgStart = addLeadTimePercent(start, leadMs, MFG_START);
  const mfgEnd = addLeadTimePercent(start, leadMs, MFG_END);
  const week = 7 * 24 * 60 * 60 * 1000;
  return {
    engineering: {
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(engEnd),
      weeks: Math.round(((engEnd.getTime() - start.getTime()) / week) * 10) / 10,
    },
    manufacturing: {
      startDate: formatDateOnly(mfgStart),
      endDate: formatDateOnly(mfgEnd),
      weeks: Math.round(((mfgEnd.getTime() - mfgStart.getTime()) / week) * 10) / 10,
    },
  };
}

// Severity buckets per product decision: 0-3 green, 4-10 yellow, 11+ red.
// Negative drift (ahead of baseline) is always green.
export function computeDriftSeverity(driftDays: number): "green" | "yellow" | "red" {
  const d = Math.max(0, driftDays);
  if (d <= 3) return "green";
  if (d <= 10) return "yellow";
  return "red";
}

function buildSchedule(p: typeof projectsTable.$inferSelect) {
  const windows = computePhaseWindows(p.activeStartDate, p.activeDeliveryDate);
  return {
    baselineStartDate: p.baselineStartDate,
    baselineDeliveryDate: p.baselineDeliveryDate,
    activeStartDate: p.activeStartDate,
    activeDeliveryDate: p.activeDeliveryDate,
    scheduleDriftDays: p.scheduleDriftDays ?? 0,
    driftSeverity: computeDriftSeverity(p.scheduleDriftDays ?? 0),
    delayReason: p.delayReason,
    delayNotes: p.delayNotes,
    engineeringPhase: windows.engineering,
    manufacturingPhase: windows.manufacturing,
  };
}

function buildProject(p: typeof projectsTable.$inferSelect, realizedEcoCents = 0) {
  // Original Contract Value comes from the frozen column; for legacy projects
  // created before that column existed, fall back to parsing totalPrice text.
  const originalCents = p.originalContractValueCents ?? parseMoneyToCents(p.totalPrice);
  const currentCents = originalCents === null ? null : originalCents + realizedEcoCents;
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
    originalContractValue: centsToDollars(originalCents),
    currentContractValue: centsToDollars(currentCents),
    deliveryDate: p.deliveryDate,
    scopeOfWork: p.scopeOfWork,
    notes: p.notes,
    priority: p.priority as "low" | "medium" | "high",
    createdById: p.createdById,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    schedule: buildSchedule(p),
  };
}

// Sum of realized (approved/implemented) ECO cost impacts for a single project,
// in integer cents. Used to compute Current Contract Value consistently.
async function getRealizedEcoCents(projectId: number): Promise<number> {
  const rows = await db
    .select({ costImpactCents: engineeringChangeOrdersTable.costImpactCents })
    .from(engineeringChangeOrdersTable)
    .where(
      and(
        eq(engineeringChangeOrdersTable.projectId, projectId),
        inArray(engineeringChangeOrdersTable.status, ["approved", "implemented"]),
      ),
    );
  return rows.reduce((sum, e) => sum + e.costImpactCents, 0);
}

// Same as above but batched across many projects (avoids N+1 on the list view).
async function getRealizedEcoCentsByProject(
  projectIds: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (projectIds.length === 0) return out;
  const rows = await db
    .select({
      projectId: engineeringChangeOrdersTable.projectId,
      costImpactCents: engineeringChangeOrdersTable.costImpactCents,
    })
    .from(engineeringChangeOrdersTable)
    .where(
      and(
        inArray(engineeringChangeOrdersTable.projectId, projectIds),
        inArray(engineeringChangeOrdersTable.status, ["approved", "implemented"]),
      ),
    );
  for (const r of rows) {
    out.set(r.projectId, (out.get(r.projectId) ?? 0) + r.costImpactCents);
  }
  return out;
}

function getDepartmentTaskTiming(project: typeof projectsTable.$inferSelect, departmentName: string) {
  // Task generation always uses ACTIVE dates so calendars/boards reflect the
  // current operational schedule.
  const start = parseDateOnly(project.activeStartDate ?? project.startDate);
  const delivery = parseDateOnly(project.activeDeliveryDate ?? project.deliveryDate);
  if (!start || !delivery || delivery.getTime() <= start.getTime()) return {};

  const leadMs = delivery.getTime() - start.getTime();
  const leadDays = leadMs / (24 * 60 * 60 * 1000);

  if (departmentName === "ENGINEERING") {
    return {
      startDate: formatDateOnly(start),
      dueDate: formatDateOnly(addLeadTimePercent(start, leadMs, ENG_END)),
      expectedHours: Math.max(1, Math.round(leadDays * ENGINEERING_PHASE_PCT * 8)),
    };
  }

  if (departmentName === "MANUFACTURING") {
    return {
      startDate: formatDateOnly(addLeadTimePercent(start, leadMs, MFG_START)),
      dueDate: formatDateOnly(addLeadTimePercent(start, leadMs, MFG_END)),
      expectedHours: Math.max(1, Math.round(leadDays * MANUFACTURING_PHASE_PCT * 8)),
    };
  }

  return {};
}

router.get("/projects", requireAuth, async (_req, res): Promise<void> => {
  const projects = await db
    .select()
    .from(projectsTable)
    .where(excludeOAContainerProject)
    .orderBy(projectsTable.createdAt);
  const realizedByProject = await getRealizedEcoCentsByProject(projects.map(p => p.id));
  res.json(
    ListProjectsResponse.parse(
      projects.map(p => buildProject(p, realizedByProject.get(p.id) ?? 0)),
    ),
  );
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

  const { parsedTasks: _ignore, ...projectData } = parsed.data;

  // On first create, baseline = active = the user-entered dates. Baseline
  // is then frozen — only the dedicated /reschedule endpoint may move
  // active dates without touching it.
  const initialStart = projectData.startDate ?? null;
  const initialDelivery = projectData.deliveryDate ?? null;
  const [project] = await db.insert(projectsTable).values({
    ...projectData,
    status: "active",
    createdById: user.id,
    baselineStartDate: initialStart,
    baselineDeliveryDate: initialDelivery,
    activeStartDate: initialStart,
    activeDeliveryDate: initialDelivery,
    scheduleDriftDays: 0,
    // Freeze the Original Contract Value at creation by parsing the entered
    // total price. ECO cost impacts later adjust the Current Contract Value.
    originalContractValueCents: parseMoneyToCents(projectData.totalPrice),
  }).returning();

  // Read auto_populate_tasks setting
  const settingsRows = await db.select().from(settingsTable);
  const autoPopulate = !settingsRows.some(s => s.key === "auto_populate_tasks" && s.value === "false");

  // Fetch all templates from DB
  const allTemplates = await db
    .select()
    .from(taskTemplatesTable)
    .orderBy(asc(taskTemplatesTable.sortOrder));

  // Office/Admin templates must never seed into a real project. They are
  // user-scoped and live under the hidden Office/Admin container project,
  // surfaced via the seed-on-membership flow in users.ts.
  const oaDeptId = await getOADepartmentId();
  const projectEligibleTemplates = oaDeptId === null
    ? allTemplates
    : allTemplates.filter(t => t.departmentId !== oaDeptId);

  // Determine which templates to apply
  const { selectedTaskIds } = req.body as { selectedTaskIds?: number[] };
  const templatesToApply = autoPopulate
    ? projectEligibleTemplates
    : Array.isArray(selectedTaskIds) && selectedTaskIds.length > 0
      ? projectEligibleTemplates.filter(t => selectedTaskIds.includes(t.id))
      : [];

  if (templatesToApply.length > 0) {
    const globalDepts = await db
      .select()
      .from(departmentsTable)
      .where(isNull(departmentsTable.projectId));
    const deptById = new Map(globalDepts.map(d => [d.id, d]));

    // Group templates by departmentId
    const byDept = new Map<number, typeof templatesToApply>();
    for (const t of templatesToApply) {
      if (!byDept.has(t.departmentId)) byDept.set(t.departmentId, []);
      byDept.get(t.departmentId)!.push(t);
    }

    for (const [deptId, tasks] of byDept.entries()) {
      const deptRecord = deptById.get(deptId);
      if (!deptRecord) continue;
      for (const task of tasks) {
        const timing = getDepartmentTaskTiming(project, deptRecord.name);
        await db.insert(tasksTable).values({
          title: task.title,
          status: "backlog",
          priority: "medium",
          projectId: project.id,
          departmentId: deptRecord.id,
          assignerId: user.id,
          elapsedSeconds: 0,
          timerRunning: false,
          ...timing,
        });
      }
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
    const startDate = extractStartDate(text) ?? "";
    const { name: partNumber, scopeOfWork: rawScope, fullDescription } = extractPartNumberAndDescription(text);
    const scopeOfWork = rawScope || fullDescription || "";
    const description = extractBriefDescription(text) || scopeOfWork.split("\n")[0] || "";
    const deliveryDate = extractDeliveryDate(text, startDate);
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
      deliveryDate: deliveryDate ?? "",
      scopeOfWork,
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

// Normalize a field value extracted from the PDF:
// – Collapses spaces within digit sequences (rendering artifacts like "92  618" → "92618")
// – Collapses spaces on BOTH sides of a dash (e.g. "Denso  -  MO" → "Denso-MO")
// – Merges split letter-groups (e.g. "P  kwy" → "Pkwy")
// – Normalises commas / stray dots
function normField(s: string): string {
  let v = s;
  // 1. Collapse digit gaps (multiple passes)
  for (let i = 0; i < 5; i++) {
    const n = v.replace(/(\d)\s+(\d)/g, "$1$2").replace(/,\s+(\d)/g, ",$1").replace(/\$\s+/g, "$");
    if (n === v) break;
    v = n;
  }
  // 2. Collapse spaces-around-dash that are PDF column-separator artefacts (2+ spaces on both sides)
  v = v.replace(/\s{2,}[-–]\s{2,}/g, "-").replace(/\s*[-–]\s*/g, "-");
  // 3. Tidy commas and trailing stray dots
  v = v.replace(/\s*,\s*/g, ", ").replace(/\s+\./g, ".");
  // 4. Collapse any remaining multiple spaces to single FIRST, so the letter-merge
  //    step below operates on single-space-separated text (e.g. "P  kwy" → "P kwy")
  v = v.replace(/\s{2,}/g, " ");
  // 5. Merge single-letter groups that were split by PDF rendering (e.g. "P kwy" → "Pkwy")
  v = v.replace(/\b([A-Za-z]{1,4})\s([a-z]{2,6})\b/g, "$1$2");
  return v.trim();
}

// Normalise a phone number: collapse digit gaps and dash-with-spaces, preserve "x NNN"
function normalizePhone(s: string): string {
  let v = s;
  for (let i = 0; i < 5; i++) {
    const n = v.replace(/(\d)\s+(\d)/g, "$1$2").replace(/\s*-\s*/g, "-");
    if (n === v) break;
    v = n;
  }
  return v.replace(/x(\d)/g, "x $1").replace(/\s{2,}/g, " ").trim();
}

// Handles both "Company  :  Name  Contact" (colon, AW) and
//              "Company  Name  Contact"    (no colon, BridgeMed/Denso)
function extractCompany(text: string): string | null {
  const m = text.match(/Company\s*:?\s{1,12}(.+?)\s{2,}Contact/i);
  if (m) return normField(m[1]);
  for (const label of ["Customer", "Client", "Bill To"]) {
    const alt = text.match(new RegExp(`${label}\\s*:\\s*([^\\n\\r:]{2,60})`, "i"));
    if (alt) return normField(alt[1]);
  }
  return null;
}

// Handles "Contact  :?  Name  (until known next field | EOL)"
// Stops only at 2+ spaces BEFORE a known field label, preventing premature
// truncation of names like "Mr.  Giancarlo Touzard" where the gap is a PDF artefact.
function extractContact(text: string): string | null {
  const m = text.match(/Contact\s*:?\s{1,12}(.+?)(?:\s{2,}(?:Phone|Email|Fax|Address|City|Company)\b|\n|$)/i);
  if (m) return normField(m[1]);
  for (const label of ["Attention", "Attn"]) {
    const alt = text.match(new RegExp(`${label}\\s*:\\s*([^\\n\\r:]{2,60})`, "i"));
    if (alt) return normField(alt[1]);
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

// Handles both colon ("Address  :  Street  Phone  :  ...") and
//          no-colon ("Address  Street  Phone  ...") layouts.
// Also picks up the city/state from the "City, State  City, ST XXXXX  Email" row.
function extractAddress(text: string): string | null {
  // Street from the Address row (ends at "Phone" or "Email" column, 2+ spaces)
  const streetM = text.match(/Address\s*:?\s{1,12}(.+?)\s{2,}(?:Phone|Email)/i);
  const street = streetM ? normField(streetM[1]) : null;

  // City/State — try the labeled "City, State  value  Email" row (BridgeMed/Denso).
  // Only stop at 2+ spaces BEFORE a known field label (or newline/EOL) so that
  // "Murrieta  , CA 92656  Email" captures the full "Murrieta  , CA 92656".
  let city: string | null = null;
  const labeledCityM = text.match(/City\s*,?\s*State\s*:?\s{1,12}(.+?)(?:\s{2,}(?:Email|Phone)\b|\n|$)/i);
  if (labeledCityM) {
    city = normField(labeledCityM[1]);
  } else {
    // Fallback: continuation line "Anaheim  , CA  92801  Email" (AW style — no "City, State" label)
    const contM = text.match(/([A-Za-z][\w\s,]+\d{4,6})\s{2,}Email\s*:/i)
      ?? text.match(/\n([A-Za-z][\w\s,]+\d{4,6})\s+Email\s*:/i);
    if (contM) city = normField(contM[1]);
  }

  if (street && city) return `${street}, ${city}`;
  if (street) return street;
  // Generic fallback for colon-style without a Phone column delimiter
  const generic = text.match(/Address\s*:\s*([^\n\r]{5,120})/i);
  return generic ? normField(generic[1]) : null;
}

// Address row: "Address  [addr]  Phone  :?  (xxx)  ..."
// Uses a GREEDY capture to grab the full phone (pdf2json inserts spaces within numbers).
// Stops only at 2+ spaces followed by a letter (new column) or end-of-line.
// Handles dash-separated, dot-separated, and parenthetical formats.
function extractPhone(text: string): string | null {
  // Primary: inline with Address row
  const m = text.match(/Address.+?Phone\s*:?\s{1,10}([\d\s\(\)\-\+\.x]{6,40})(?=\s{2,}[A-Za-z]|\n|$)/i);
  if (m) return normalizePhone(m[1]);
  // Secondary: labeled phone (Customer/Client/Contact Phone: ...)
  const alt = text.match(/(?:Customer|Client|Contact)\s+Phone\s*:\s*([\d\s\-\(\)\+\.x]{7,40})(?=\s{2,}[A-Za-z]|\n|$)/i);
  if (alt) return normalizePhone(alt[1]);
  // Tertiary: standalone "Phone: ..." line (dot-separated common in Toddco quotes)
  const standalone = text.match(/\bPhone\s*:?\s*([\d\s\(\)\-\+\.x]{7,30})(?=\s{2,}[A-Za-z]|\n|$)/i);
  if (standalone) return normalizePhone(standalone[1]);
  return null;
}

// Handles direct email, spaced "@" (Denso: "Ernesto.Montano  @  na.denso.com"),
// and generic fallback.
function extractEmail(text: string): string | null {
  // Direct (no spaces around @)
  const direct = text.match(/Email\s*:?\s{1,12}([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/i);
  if (direct) return direct[1].trim();
  // Spaced @ (pdf2json artefact)
  const spaced = text.match(/Email\s*:?\s{1,12}([A-Za-z0-9._%+\-]+)\s*@\s*([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/i);
  if (spaced) return `${spaced[1]}@${spaced[2]}`;
  // Generic fallback (handles spaced @ anywhere in text)
  const generic = text.match(/\b([A-Za-z0-9._%+\-]+)\s*@\s*([A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/);
  if (generic) return `${generic[1]}@${generic[2]}`;
  return null;
}

// Generic part-number prefix words to strip from inline descriptions
const PART_NUM_PREFIXES = new Set(["CUSTOM", "MISC", "Custom", "Standard", "STANDARD"]);

function stripPartNumPrefix(rest: string): string {
  const allCaps = rest.replace(/^[A-Z][A-Z0-9]+\s*[-–]?\s*/, "").trim();
  if (allCaps !== rest) return allCaps;
  const words = rest.split(/\s+/);
  if (words.length > 0 && PART_NUM_PREFIXES.has(words[0])) return words.slice(1).join(" ");
  return rest;
}

// Robust description + scope-of-work extractor handling three Toddco quote layouts:
//  1. BridgeMed  – description on a SEPARATE line BEFORE the qty row
//  2. Denso / AW – description INLINE on the qty row, after the part-number token
//  3. Sub-items  – bullet lines after the qty row
//
// Project name: the first Part Number / description phrase, truncated at "including the following:"
// Scope of work: the bullet/detail lines that follow "including the following:"
function extractPartNumberAndDescription(text: string): { name: string; scopeOfWork: string; fullDescription: string } {
  const lines = text.split("\n");

  // Find the column-header row ("Qty. Part Number Description ...")
  const headerIdx = lines.findIndex(l => /\bQty\.?\b/i.test(l) && /\bDescription\b/i.test(l));
  if (headerIdx < 0) return { name: "", scopeOfWork: "", fullDescription: "" };

  // Find end of line-items section (Total/Subtotal row)
  let endIdx = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^\s*(?:Total[\s\w]*[\$:]|TOTAL\s*:|Subtotal\s*:|Delivery\s*:)/i.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  // Scope-of-work lines (bullet points and detail lines from "including the following:")
  const scopeLines: string[] = [];
  // All item description lines for fullDescription
  const items: string[] = [];
  // First Part Number encountered in a qty row — used as the project name.
  let firstPartNumber: string | null = null;
  // Whether we are past "including the following:" in the current item
  let inScope = false;

  function addItem(chunk: string) {
    if (!chunk || chunk.length < 3) return;
    const realWords = chunk.split(/\s+/).filter(w => /[A-Za-z]{2,}/.test(w)).length;
    if (!/[A-Z]/.test(chunk) && realWords < 2) return;
    const startsLower = /^[a-z]/.test(chunk);
    if (startsLower && items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1]} ${chunk}`.trim();
    } else {
      items.push(chunk);
    }
  }

  for (let i = headerIdx + 1; i < endIdx; i++) {
    const raw = collapseDigits(lines[i]);
    const trimmed = raw.trim();

    if (!trimmed) continue;
    if (/^\$[\d,\.\s]+$/.test(trimmed)) continue;
    if (/^[\d\s,\.]+$/.test(trimmed)) continue;

    const qtyM = trimmed.match(/^(\d+)\s+/);
    if (qtyM) {
      // ── Qty row: reset scope flag, parse part number + inline description ────
      inScope = false;
      let rest = trimmed.slice(qtyM[0].length);
      rest = rest.replace(/\s*\$[\d,\.\s]+(\$[\d,\.\s]+)?\s*$/, "").trim();

      // Check if this row contains "including the following:" — split there
      const inclIdx = rest.search(/\s+including\s+the\s+following\s*:/i);
      let nameCandidate = rest;
      if (inclIdx >= 0) {
        nameCandidate = rest.slice(0, inclIdx).trim();
        inScope = true;
      }

      // Capture first Part Number for the project name
      if (!firstPartNumber && nameCandidate) {
        const naturalWordCount = nameCandidate.replace(/\s{2,}/g, " ").split(/\s+/)
          .filter(w => /[a-z]{3,}/i.test(w) && !/^\d+$/.test(w)).length;
        let candidate: string;
        if (naturalWordCount <= 4) {
          candidate = nameCandidate.replace(/\s+/g, " ").trim();
        } else {
          const sep = nameCandidate.search(/\s{2,}/);
          candidate = (sep >= 0 ? nameCandidate.slice(0, sep) : nameCandidate)
            .replace(/\s+/g, " ").trim();
        }
        // Skip meaningless single ALL-CAPS tokens (e.g. "CUSTOM", "MISC") and
        // use the description portion that comes after the first double-space gap
        const isBareToken = /^[A-Z][A-Z\d\-]+$/.test(candidate.replace(/\s+/g, "")) ||
          PART_NUM_PREFIXES.has(candidate.trim());
        if (isBareToken && nameCandidate.search(/\s{2,}/) >= 0) {
          const sep = nameCandidate.search(/\s{2,}/);
          const afterToken = nameCandidate.slice(sep).replace(/\s+/g, " ").trim();
          firstPartNumber = afterToken || candidate;
        } else {
          firstPartNumber = candidate;
        }
      }

      // If inline description exists (before "including the following:")
      if (nameCandidate.split(/\s+/).filter(w => w.length > 0).length >= 3) {
        const desc = stripPartNumPrefix(nameCandidate).replace(/\s{2,}/g, " ").trim();
        if (desc.split(/\s+/).filter(w => w.length > 0).length >= 2 && !/^[\$\d,\.]+$/.test(desc)) {
          addItem(desc);
        }
      }
    } else {
      // ── Non-qty row ───────────────────────────────────────────────────────────
      // If we're inside "including the following:" — collect as scope of work
      if (inScope) {
        // Include bullet points and plain text lines
        const scopeLine = trimmed.replace(/^[•\u2022\u25CF\u2023oO○◦]\s*/u, "").replace(/\s{2,}/g, " ").trim();
        if (scopeLine.length >= 3) scopeLines.push(scopeLine);
        continue;
      }

      // Check if this standalone line contains "including the following:"
      const inclIdx = trimmed.search(/\s+including\s+the\s+following\s*:/i);
      if (inclIdx >= 0) {
        const before = trimmed.slice(0, inclIdx).trim();
        if (before.length >= 3) addItem(before);
        inScope = true;
        continue;
      }

      if (/^[A-Z]{4,}\b/.test(trimmed)) continue;             // ALL-CAPS part-number token
      if (/^[A-Za-z]+\s*[-–]\s*\d+\b/.test(trimmed)) continue; // "Fabrication - 001"
      if (/^[•\u2022\u25CF\u2023oO○◦]\s/.test(trimmed)) continue; // bullet point (outside scope)

      const desc = trimmed.replace(/\s{2,}/g, " ").trim();
      if (desc.length >= 5) addItem(desc);
    }
  }

  if (items.length === 0 && !firstPartNumber) return { name: "", scopeOfWork: "", fullDescription: "" };

  // Fallback project name from first description sentence (≤7 words)
  const firstDescName = items[0]
    ? items[0]
      .replace(/\s+(?:to\s+support|for\s+your|with\s+variable|including)\b.*/i, "")
      .split(/\s+/)
      .slice(0, 7)
      .join(" ")
    : "";

  // Project name = first Part Number (preferred) or description fallback
  // Strip any trailing "including the following:" fragment from the name
  const rawName = firstPartNumber || firstDescName;
  const projectName = rawName.replace(/\s+including\s+the\s+following\s*:?.*/i, "").trim();

  const scopeOfWork = scopeLines.join("\n");
  const fullDescription = items.join("\n\n");

  return { name: projectName, scopeOfWork, fullDescription };
}

// Extracts the delivery date by finding a "XX week" lead time in the PDF and
// adding that many weeks to the provided start date.
// Returns an ISO date string (YYYY-MM-DD) or null if not found.
function extractDeliveryDate(text: string, startDate: string): string | null {
  if (!startDate) return null;

  // Patterns (loosest last so more specific ones match first)
  const patterns = [
    /delivery\s*(?:time|lead\s*time|date)?\s*:?\s*(\d+)\s*[-–]?\s*weeks?\b/i,
    /(\d+)\s*[-–]?\s*weeks?\s+(?:ARO|after\s+receipt|lead\s*time|from\s+(?:receipt|order|PO|award|date\s+of\s+order))/i,
    /lead\s*time\s*:?\s*(\d+)\s*[-–]?\s*weeks?\b/i,
    /(\d+)\s*[-–]?\s*weeks?\s+(?:delivery|from\s+start|after\s+start)/i,
    /(\d+)\s*[-–]?\s*week\s+(?:schedule|program|build|project)/i,
    // Generic: "XX Weeks" appearing within 80 chars of "schedule" or "timeline"
    /(?:schedule|timeline|duration)[^.]{0,80}?(\d{1,3})\s*[-–]?\s*weeks?\b/i,
    // Last resort: any standalone "XX weeks" or "XX-week"
    /\b(\d{1,3})\s*[-–]?\s*weeks?\b/i,
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const weeks = parseInt(m[1], 10);
      if (isNaN(weeks) || weeks <= 0 || weeks > 260) continue;
      const base = new Date(startDate);
      if (isNaN(base.getTime())) continue;
      base.setDate(base.getDate() + weeks * 7);
      return base.toISOString().split("T")[0];
    }
  }
  return null;
}

// Extracts the first paragraph from a "Conclusion" section near the end of the PDF.
// Falls back to null so the caller can use Scope of Work instead.
function extractBriefDescription(text: string): string | null {
  // Look for a "Conclusion" heading (case-insensitive)
  const conclusionM = text.match(/\bConclusion\b[:\s\n]+([\s\S]{20,600}?)(?:\n{2,}|\n[A-Z][A-Z\s]{3,}:|$)/i);
  if (conclusionM) {
    const raw = conclusionM[1]
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .join(" ");
    // Return first sentence or first 200 chars
    const sentence = raw.replace(/\s{2,}/g, " ").trim();
    return sentence.length > 0 ? sentence.slice(0, 400) : null;
  }
  return null;
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
  const lines = text.split("\n");

  function fmt(n: number): string {
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // Aggressively collapse fragmented dollar amounts like "$  1,  213  ,  8  0  8" → "$1,213,808"
  function squashAmount(s: string): string {
    let v = s;
    for (let i = 0; i < 8; i++) {
      const n = v
        .replace(/\$\s+/g, "$")
        .replace(/(\d)\s+(\d)/g, "$1$2")
        .replace(/(\d)\s+,/g, "$1,")
        .replace(/,\s+(\d)/g, ",$1");
      if (n === v) break;
      v = n;
    }
    return v;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bTotal\b/i.test(line)) continue;

    // ── Same-line amount (Denso: "Total USD: $15,627", AW: "TOTAL: $1,213,808") ──
    const squashed = squashAmount(line);
    const sameM = squashed.match(/\bTotal\b[^$\d]*\$?([\d,]+(?:\.\d+)?)/i);
    if (sameM) {
      const n = parseFloat(sameM[1].replace(/,/g, ""));
      if (!isNaN(n) && n >= 100) return fmt(n);
    }

    // ── Amount on the PREVIOUS line (BridgeMed: "$  6  ,  50  0" then "Total US $:") ──
    if (i > 0) {
      const prev = squashAmount(lines[i - 1]);
      const prevM = prev.match(/\$([\d,]+(?:\.\d+)?)\s*$/);
      if (prevM) {
        const n = parseFloat(prevM[1].replace(/,/g, ""));
        if (!isNaN(n) && n >= 100) return fmt(n);
      }
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
  if (await rejectIfHiddenProject(res, id)) return;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Sum realized (approved/implemented) ECO cost impacts so the single-project
  // view reports an accurate Current Contract Value.
  res.json(GetProjectResponse.parse(buildProject(project, await getRealizedEcoCents(id))));
});

router.patch("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  if (await rejectIfHiddenProject(res, id)) return;

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Keep the legacy startDate/deliveryDate columns in sync with the active
  // columns so existing consumers don't have to change. Baseline columns are
  // NEVER touched by a normal PATCH — that's the /reschedule endpoint's job.
  // For first-set (baseline still null after backfill should never happen, but
  // defensively allow it), populate baseline too.
  const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const patch: Partial<typeof projectsTable.$inferInsert> = { ...parsed.data };
  if (parsed.data.startDate !== undefined) {
    patch.activeStartDate = parsed.data.startDate;
    // Baseline is the FROZEN original commitment. Only seed it when still null,
    // and seed from the project's PRE-EDIT committed date — never from the new
    // value the user just entered (that would erase the original reference).
    if (!existing.baselineStartDate) {
      patch.baselineStartDate = existing.activeStartDate ?? existing.startDate ?? null;
    }
  }
  if (parsed.data.deliveryDate !== undefined) {
    patch.activeDeliveryDate = parsed.data.deliveryDate;
    if (!existing.baselineDeliveryDate) {
      patch.baselineDeliveryDate = existing.activeDeliveryDate ?? existing.deliveryDate ?? null;
    }
    // Recompute drift against the frozen baseline (existing, or the just-seeded
    // pre-edit value), not the newly entered delivery date.
    const effectiveBaseline =
      existing.baselineDeliveryDate ?? existing.activeDeliveryDate ?? existing.deliveryDate;
    const baselineDel = parseDateOnly(effectiveBaseline);
    const activeDel = parseDateOnly(parsed.data.deliveryDate);
    if (baselineDel && activeDel) {
      patch.scheduleDriftDays = diffDays(activeDel, baselineDel);
    }
  }

  const [updated] = await db.update(projectsTable).set(patch).where(eq(projectsTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(UpdateProjectResponse.parse(buildProject(updated, await getRealizedEcoCents(id))));
});

router.post("/projects/:projectId/reschedule", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  if (await rejectIfHiddenProject(res, id)) return;

  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Permission: admins or the project creator only.
  if (user.role !== "admin" && existing.createdById !== user.id) {
    res.status(403).json({ error: "Only admins or the project creator may reschedule." });
    return;
  }

  const parsed = RescheduleProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { activeStartDate, activeDeliveryDate, delayReason, delayNotes } = parsed.data;
  if (activeStartDate === undefined && activeDeliveryDate === undefined) {
    res.status(400).json({ error: "Must change at least one of activeStartDate / activeDeliveryDate." });
    return;
  }

  // Capture old active window before mutation so we can shift matching tasks.
  const oldActiveStart = existing.activeStartDate;
  const oldActiveDelivery = existing.activeDeliveryDate;

  const newActiveStart = activeStartDate !== undefined ? activeStartDate : oldActiveStart;
  const newActiveDelivery = activeDeliveryDate !== undefined ? activeDeliveryDate : oldActiveDelivery;

  // Baseline is the FROZEN original commitment and is NEVER moved by a
  // reschedule. For legacy rows whose baseline is still null, seed it from the
  // PRE-reschedule active dates (the last committed schedule before this move)
  // so we have a correct frozen reference and drift can be computed.
  const frozenBaselineStart = existing.baselineStartDate ?? oldActiveStart ?? existing.startDate ?? null;
  const frozenBaselineDelivery = existing.baselineDeliveryDate ?? oldActiveDelivery ?? existing.deliveryDate ?? null;

  // Drift is driven exclusively by delivery delta. Per product decision: if
  // only the start date changes, drift stays 0.
  let scheduleDriftDays = existing.scheduleDriftDays ?? 0;
  const baselineDelivery = parseDateOnly(frozenBaselineDelivery);
  const newActiveDeliveryDate = parseDateOnly(newActiveDelivery);
  if (baselineDelivery && newActiveDeliveryDate) {
    scheduleDriftDays = diffDays(newActiveDeliveryDate, baselineDelivery);
  } else if (!newActiveDeliveryDate || !baselineDelivery) {
    scheduleDriftDays = 0;
  }

  const [updated] = await db
    .update(projectsTable)
    .set({
      // Re-assert the frozen baseline (no-op when already set; seeds legacy nulls).
      baselineStartDate: frozenBaselineStart,
      baselineDeliveryDate: frozenBaselineDelivery,
      activeStartDate: newActiveStart,
      activeDeliveryDate: newActiveDelivery,
      // Keep legacy columns in sync so calendar/board/etc don't break.
      startDate: newActiveStart,
      deliveryDate: newActiveDelivery,
      scheduleDriftDays,
      delayReason,
      delayNotes: delayNotes ?? null,
    })
    .where(eq(projectsTable.id, id))
    .returning();

  // ── Best-effort task shifting ──────────────────────────────────────────
  // Recompute Engineering + Manufacturing windows for both the OLD and NEW
  // active schedules. Any generated task whose current (startDate, dueDate)
  // exactly matches the old window for its department gets shifted to the
  // new window. Manually-edited tasks (whose dates don't match) are left
  // alone — they keep whatever the user set.
  try {
    const oldEng = computePhaseWindows(oldActiveStart, oldActiveDelivery).engineering;
    const oldMfg = computePhaseWindows(oldActiveStart, oldActiveDelivery).manufacturing;
    const newWindows = computePhaseWindows(newActiveStart, newActiveDelivery);

    const projectTasks = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.projectId, id));
    const globalDepts = await db
      .select()
      .from(departmentsTable)
      .where(isNull(departmentsTable.projectId));
    const deptById = new Map(globalDepts.map(d => [d.id, d]));

    let shifted = 0;
    let skipped = 0;
    for (const t of projectTasks) {
      if (!t.departmentId) continue;
      const dept = deptById.get(t.departmentId);
      if (!dept) continue;
      let oldWin: PhaseWindow | null = null;
      let newWin: PhaseWindow | null = null;
      if (dept.name === "ENGINEERING") { oldWin = oldEng; newWin = newWindows.engineering; }
      else if (dept.name === "MANUFACTURING") { oldWin = oldMfg; newWin = newWindows.manufacturing; }
      if (!oldWin || !newWin || !newWin.startDate || !newWin.endDate) continue;

      if (t.startDate === oldWin.startDate && t.dueDate === oldWin.endDate) {
        await db
          .update(tasksTable)
          .set({ startDate: newWin.startDate, dueDate: newWin.endDate })
          .where(eq(tasksTable.id, t.id));
        shifted++;
      } else if (t.startDate || t.dueDate) {
        skipped++;
      }
    }
    req.log.info({ projectId: id, shifted, skipped }, "reschedule: task shift summary");
  } catch (err) {
    req.log.error({ err, projectId: id }, "reschedule: best-effort task shift failed");
  }

  res.json(GetProjectResponse.parse(buildProject(updated, await getRealizedEcoCents(id))));
});

router.delete("/projects/:projectId", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  if (await rejectIfHiddenProject(res, id)) return;

  // Get all task IDs under this project for child-record cleanup
  const projectTasks = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, id));

  if (projectTasks.length > 0) {
    const taskIds = projectTasks.map(t => t.id);
    // Delete task attachments and relations that reference these tasks
    await db.delete(taskAttachmentsTable).where(inArray(taskAttachmentsTable.taskId, taskIds));
    await db.delete(taskRelationsTable).where(inArray(taskRelationsTable.taskId, taskIds));
  }

  // Delete all tasks for the project
  await db.delete(tasksTable).where(eq(tasksTable.projectId, id));
  // Delete all departments for the project
  await db.delete(departmentsTable).where(eq(departmentsTable.projectId, id));
  // Delete inventory allocations so released parts become available again
  await db.delete(inventoryAllocationsTable).where(eq(inventoryAllocationsTable.projectId, id));
  // Delete the project itself
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  res.sendStatus(204);
});

router.get("/projects/:projectId/summary", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }
  if (await rejectIfHiddenProject(res, id)) return;

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

// ── Project Attachments ──────────────────────────────────────────────────────

function buildProjectAttachment(a: typeof projectAttachmentsTable.$inferSelect) {
  return {
    id: a.id,
    projectId: a.projectId,
    fileName: a.fileName,
    objectPath: a.objectPath,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    isPinned: a.isPinned,
    uploadedById: a.uploadedById,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/projects/:projectId/attachments", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.projectId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  if (await rejectIfHiddenProject(res, id)) return;

  const attachments = await db.select().from(projectAttachmentsTable)
    .where(eq(projectAttachmentsTable.projectId, id))
    .orderBy(projectAttachmentsTable.isPinned, projectAttachmentsTable.createdAt);

  res.json(attachments.map(buildProjectAttachment));
});

router.post("/projects/:projectId/attachments", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.projectId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  if (await rejectIfHiddenProject(res, id)) return;

  const parsed = parseProjectAttachmentBody(req.body);
  if (!parsed) { res.status(400).json({ error: "Invalid attachment body" }); return; }

  const OBJECT_PATH_RE = /^\/objects\/[a-z0-9/_-]+$/i;
  if (!OBJECT_PATH_RE.test(parsed.objectPath)) {
    res.status(400).json({ error: "Invalid object path" }); return;
  }

  const existing = await db.select({ id: projectAttachmentsTable.id })
    .from(projectAttachmentsTable)
    .where(eq(projectAttachmentsTable.objectPath, parsed.objectPath));

  if (existing.length > 0) { res.status(409).json({ error: "Object already attached" }); return; }

  const [attachment] = await db.insert(projectAttachmentsTable).values({
    projectId: id,
    fileName: parsed.fileName,
    objectPath: parsed.objectPath,
    fileSize: parsed.fileSize,
    mimeType: parsed.mimeType,
    isPinned: parsed.isPinned,
    uploadedById: user.id,
  }).returning();

  res.status(201).json(buildProjectAttachment(attachment));
});

router.delete("/projects/:projectId/attachments/:attachmentId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  const attachmentId = parseInt(req.params.attachmentId, 10);
  const clerkId = req.userId;
  if (await rejectIfHiddenProject(res, projectId)) return;

  if (!clerkId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [dbUser] = await db.select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable).where(eq(usersTable.clerkId, clerkId));

  if (!dbUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [attachment] = await db.select({ uploadedById: projectAttachmentsTable.uploadedById })
    .from(projectAttachmentsTable)
    .where(and(eq(projectAttachmentsTable.id, attachmentId), eq(projectAttachmentsTable.projectId, projectId)));

  if (!attachment) { res.status(404).json({ error: "Attachment not found" }); return; }

  if (dbUser.role !== "admin" && attachment.uploadedById !== dbUser.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  await db.delete(projectAttachmentsTable).where(
    and(eq(projectAttachmentsTable.id, attachmentId), eq(projectAttachmentsTable.projectId, projectId))
  );
  res.sendStatus(204);
});

router.get("/projects/:projectId/all-attachments", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.projectId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project ID" }); return; }
  if (await rejectIfHiddenProject(res, id)) return;

  const [projectAttachments, projectTasks] = await Promise.all([
    db.select().from(projectAttachmentsTable)
      .where(eq(projectAttachmentsTable.projectId, id))
      .orderBy(projectAttachmentsTable.isPinned, projectAttachmentsTable.createdAt),
    db.select({ id: tasksTable.id, title: tasksTable.title, parentTaskId: tasksTable.parentTaskId })
      .from(tasksTable).where(eq(tasksTable.projectId, id)),
  ]);

  const taskIds = projectTasks.map(t => t.id);
  const allTaskAttachments = taskIds.length > 0
    ? await db.select().from(taskAttachmentsTable).where(inArray(taskAttachmentsTable.taskId, taskIds)).orderBy(taskAttachmentsTable.createdAt)
    : [];

  const taskMap = new Map(projectTasks.map(t => [t.id, t]));
  const attachmentsByTask = new Map<number, typeof allTaskAttachments>();
  for (const a of allTaskAttachments) {
    if (!attachmentsByTask.has(a.taskId)) attachmentsByTask.set(a.taskId, []);
    attachmentsByTask.get(a.taskId)!.push(a);
  }

  const taskGroups = projectTasks
    .filter(t => attachmentsByTask.has(t.id))
    .map(t => {
      const parent = t.parentTaskId ? taskMap.get(t.parentTaskId) : null;
      return {
        taskId: t.id,
        taskTitle: t.title,
        isSubtask: t.parentTaskId !== null,
        parentTaskId: t.parentTaskId ?? null,
        parentTaskTitle: parent?.title ?? null,
        attachments: (attachmentsByTask.get(t.id) ?? []).map(a => ({
          id: a.id,
          taskId: a.taskId,
          fileName: a.fileName,
          objectPath: a.objectPath,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          uploadedById: a.uploadedById,
          createdAt: a.createdAt.toISOString(),
        })),
      };
    });

  res.json({
    projectAttachments: projectAttachments.map(buildProjectAttachment),
    taskGroups,
  });
});

export default router;
