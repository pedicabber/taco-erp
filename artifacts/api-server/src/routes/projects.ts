import { Router, type IRouter } from "express";
import multer from "multer";
import { parsePdfText } from "../lib/pdfParseAdapter";
import { db, projectsTable, departmentsTable, tasksTable, taskAttachmentsTable, taskRelationsTable, projectAttachmentsTable, usersTable, settingsTable, inventoryAllocationsTable } from "@workspace/db";
import { eq, inArray, isNull } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { syncUserFromClerk } from "../lib/userSync";
import { DEPARTMENT_TASKS } from "../templateTasks";
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
    deliveryDate: p.deliveryDate,
    scopeOfWork: p.scopeOfWork,
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

  const { parsedTasks: _ignore, ...projectData } = parsed.data;

  const [project] = await db.insert(projectsTable).values({
    ...projectData,
    status: "active",
    createdById: user.id,
  }).returning();

  // Fetch all global (non-project-specific) departments once
  const globalDepts = await db
    .select()
    .from(departmentsTable)
    .where(isNull(departmentsTable.projectId));

  const deptMap = new Map(globalDepts.map(d => [d.name, d]));

  for (const { dept: deptName, color, tasks } of DEPARTMENT_TASKS) {
    // Find or create the global department
    let deptRecord = deptMap.get(deptName);
    if (!deptRecord) {
      const [created] = await db.insert(departmentsTable).values({
        name: deptName,
        color,
        projectId: null,
      }).returning();
      deptRecord = created;
      deptMap.set(deptName, created);
    } else if (deptRecord.color !== color) {
      const [updatedDept] = await db.update(departmentsTable)
        .set({ color })
        .where(eq(departmentsTable.id, deptRecord.id))
        .returning();
      deptRecord = updatedDept;
      deptMap.set(deptName, updatedDept);
    }

    for (const title of tasks) {
      await db.insert(tasksTable).values({
        title,
        status: "backlog",
        priority: "medium",
        projectId: project.id,
        departmentId: deptRecord.id,
        assignerId: user.id,
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
