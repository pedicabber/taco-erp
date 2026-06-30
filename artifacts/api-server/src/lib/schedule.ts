// ─── Schedule single source of truth ─────────────────────────────────────────
// One place resolves a project's schedule dates so every consumer (project
// GET/list, ECO summary, SQDC dashboard) sees identical values.
//
// Field roles:
//   baseline_* — the FROZEN original commitment.
//   active_*   — the current working schedule.
//   legacy start_date / delivery_date — migration/self-heal INPUTS ONLY. They
//     are used to fill a normalized field that is still null (legacy rows that
//     predate the normalized columns); they are never a normal source of truth.
//
// Resolution:
//   activeStart    = active ?? legacy
//   activeDelivery = active ?? legacy
//   baselineStart  = baseline ?? activeStart   (i.e. baseline ?? active ?? legacy)
//   baselineDelivery = baseline ?? activeDelivery
//   drift = activeDelivery − baselineDelivery, recomputed from the RESOLVED
//     dates so it can never disagree with what is displayed. The stored
//     scheduleDriftDays is only a fallback when a date is unparseable.

export type ScheduleSource = {
  baselineStartDate: string | null;
  baselineDeliveryDate: string | null;
  activeStartDate: string | null;
  activeDeliveryDate: string | null;
  startDate: string | null;
  deliveryDate: string | null;
  scheduleDriftDays: number | null;
};

export type ResolvedSchedule = {
  baselineStartDate: string | null;
  baselineDeliveryDate: string | null;
  activeStartDate: string | null;
  activeDeliveryDate: string | null;
  scheduleDriftDays: number;
};

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

export function resolveSchedule(p: ScheduleSource): ResolvedSchedule {
  const activeStartDate = p.activeStartDate ?? p.startDate ?? null;
  const activeDeliveryDate = p.activeDeliveryDate ?? p.deliveryDate ?? null;
  const baselineStartDate = p.baselineStartDate ?? activeStartDate;
  const baselineDeliveryDate = p.baselineDeliveryDate ?? activeDeliveryDate;

  let scheduleDriftDays = p.scheduleDriftDays ?? 0;
  const baseline = parseDateOnly(baselineDeliveryDate);
  const active = parseDateOnly(activeDeliveryDate);
  if (baseline && active) {
    scheduleDriftDays = diffDays(active, baseline);
  }

  return {
    baselineStartDate,
    baselineDeliveryDate,
    activeStartDate,
    activeDeliveryDate,
    scheduleDriftDays,
  };
}
