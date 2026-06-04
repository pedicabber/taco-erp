// Money helpers. All monetary values are stored as integer cents in the DB and
// exchanged with the client as decimal dollars (number).

/**
 * Parse a loose money string (e.g. "$277,810", "1234.50", "-500") into integer
 * cents. Returns null when there is no parseable numeric value.
 */
export function parseMoneyToCents(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = String(input).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Convert integer cents into decimal dollars. */
export function centsToDollars(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return cents / 100;
}

/** Convert decimal dollars (number) into integer cents. */
export function dollarsToCents(dollars: number | null | undefined): number | null {
  if (dollars === null || dollars === undefined) return null;
  return Math.round(dollars * 100);
}
