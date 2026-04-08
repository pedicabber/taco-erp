import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

export const BOOTSTRAP_ADMINS = [
  "davidjohnfrazier@gmail.com",
  "jferris@toddco.com",
  "jayf6304@gmail.com",
];

export async function bootstrapAdmins() {
  try {
    await db.update(usersTable)
      .set({ role: "admin" })
      .where(inArray(usersTable.email, BOOTSTRAP_ADMINS));
  } catch {
    // silently skip if table not ready yet
  }
}
