import type { Response } from "express";
import { usersTable } from "@workspace/db";
import { syncUserFromClerk } from "./userSync";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";

/**
 * Pure check: may this DB user create/manage Safety (LOTO) records?
 *
 * Policy: every authenticated user (Admin or Member) has Safety access. The ERP
 * currently has only Admin and Member roles and no Safety department, and LOTO
 * must be usable by all field, shop, controls, and install personnel — so the
 * module is not gated behind any role or department.
 *
 * This governs only the ability to open Safety and create/view/edit records in
 * the normal LOTO workflow. Commander-only actions (Commander Review, Authorize
 * Energization, Final Closeout, commander audit notes) are gated separately in
 * routes/loto.ts to the assigned commander or an admin, and closed records stay
 * immutable. Unauthenticated requests never reach this check (callers resolve a
 * DB user first and reject when there is none).
 */
export async function userHasSafetyAccess(
  _user: typeof usersTable.$inferSelect,
): Promise<boolean> {
  return true;
}

/**
 * Gate for Safety (LOTO) mutations.
 *
 * Returns the resolved DB user on success. On failure, writes the appropriate
 * status (401 unauthenticated / 403 forbidden) to `res` and returns null;
 * callers should `return` immediately on null.
 */
export async function requireSafetyAccess(
  req: AuthenticatedRequest,
  res: Response,
): Promise<typeof usersTable.$inferSelect | null> {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  if (await userHasSafetyAccess(user)) return user;

  res.status(403).json({ error: "Safety access denied" });
  return null;
}
