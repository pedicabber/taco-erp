import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a raw quote/project number for display.
 * Strips any trailing letters, then prepends "T3-".
 * Example: "24-1084REVC" → "T3-24-1084"
 */
export function formatQuoteNum(raw: string): string {
  if (raw.startsWith("T3-")) return raw;
  const stripped = raw.replace(/[A-Za-z]+$/, "").replace(/-$/, "");
  return `T3-${stripped}`;
}
