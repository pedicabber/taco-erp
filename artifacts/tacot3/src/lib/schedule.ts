// Shared scheduling helpers — must stay in sync with
// `artifacts/api-server/src/routes/projects.ts` (ENG=25%, MFG=30%,
// drift buckets 0-3 green / 4-10 yellow / 11+ red).

export const ENGINEERING_PHASE_PCT = 0.25;
export const MANUFACTURING_PHASE_PCT = 0.30;

const ENG_END = ENGINEERING_PHASE_PCT;
const MFG_START = ENGINEERING_PHASE_PCT;
const MFG_END = ENGINEERING_PHASE_PCT + MANUFACTURING_PHASE_PCT;

export type PhaseWindow = {
  startDate: string | null;
  endDate: string | null;
  weeks: number | null;
};

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addPct(start: Date, leadMs: number, pct: number): Date {
  return new Date(start.getTime() + Math.round(leadMs * pct));
}

export function computePhaseWindows(
  activeStartDate: string | null | undefined,
  activeDeliveryDate: string | null | undefined,
): { engineering: PhaseWindow; manufacturing: PhaseWindow } {
  const empty: PhaseWindow = { startDate: null, endDate: null, weeks: null };
  const start = parseDateOnly(activeStartDate);
  const delivery = parseDateOnly(activeDeliveryDate);
  if (!start || !delivery || delivery.getTime() <= start.getTime()) {
    return { engineering: empty, manufacturing: empty };
  }
  const leadMs = delivery.getTime() - start.getTime();
  const week = 7 * 24 * 60 * 60 * 1000;
  const engEnd = addPct(start, leadMs, ENG_END);
  const mfgStart = addPct(start, leadMs, MFG_START);
  const mfgEnd = addPct(start, leadMs, MFG_END);
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

export type DriftSeverity = "green" | "yellow" | "red";

export function computeDriftSeverity(driftDays: number): DriftSeverity {
  const d = Math.max(0, driftDays);
  if (d <= 3) return "green";
  if (d <= 10) return "yellow";
  return "red";
}

export const DELAY_REASONS = [
  { value: "customer_delay", label: "Customer delay" },
  { value: "engineering_revision", label: "Engineering revision" },
  { value: "vendor_delay", label: "Vendor delay" },
  { value: "internal_capacity", label: "Internal capacity" },
  { value: "quality_issue", label: "Quality issue" },
  { value: "scope_change", label: "Scope change" },
  { value: "engineering_change_order", label: "Engineering Change Order" },
  { value: "other", label: "Other" },
] as const;

export type DelayReasonValue = (typeof DELAY_REASONS)[number]["value"];

export function delayReasonLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return DELAY_REASONS.find(r => r.value === v)?.label ?? v;
}

export const DRIFT_SEVERITY_CLASS: Record<DriftSeverity, string> = {
  green: "text-green-600 dark:text-green-400",
  yellow: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
};

export const DRIFT_SEVERITY_BG: Record<DriftSeverity, string> = {
  green: "bg-green-500/10 border-green-500/30",
  yellow: "bg-amber-500/10 border-amber-500/30",
  red: "bg-red-500/10 border-red-500/30",
};
