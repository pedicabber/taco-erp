import { getAuth } from "@clerk/express";
import { clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import type { Request } from "express";
import { BOOTSTRAP_ADMINS } from "../bootstrapAdmins";

export async function syncUserFromClerk(req: Request): Promise<typeof usersTable.$inferSelect | null> {
  const auth = getAuth(req);
  const clerkId = auth?.userId;
  if (!clerkId) return null;

  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
  if (existing.length > 0) return existing[0];

  try {
    const clerkUser = await clerkClient.users.getUser(clerkId);
    const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
    const name = `${clerkUser.firstName ?? ""} ${clerkUser.lastName ?? ""}`.trim() || email;
    const avatarUrl = clerkUser.imageUrl ?? null;

    const role = BOOTSTRAP_ADMINS.includes(email) ? "admin" : "member";

    if (email) {
      const byEmail = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
      if (byEmail.length > 0) {
        const oldClerkId = byEmail[0].clerkId;

        let oldClerkUserStillExists = false;
        if (oldClerkId && oldClerkId !== clerkId) {
          try {
            await clerkClient.users.getUser(oldClerkId);
            oldClerkUserStillExists = true;
          } catch (lookupErr) {
            const status = (lookupErr as { status?: number })?.status;
            if (status !== 404) {
              logger.error(
                { err: lookupErr, oldClerkId, email },
                "Failed to verify old Clerk user during email-collision relink; refusing to rebind",
              );
              return null;
            }
            oldClerkUserStillExists = false;
          }
        }

        if (oldClerkUserStillExists) {
          logger.warn(
            { email, oldClerkId, newClerkId: clerkId, dbUserId: byEmail[0].id },
            "Refusing to rebind DB user by email: prior Clerk identity is still active. Possible email reuse / account takeover attempt.",
          );
          return null;
        }

        const updates: Partial<typeof usersTable.$inferInsert> = { clerkId };
        if (!byEmail[0].name || byEmail[0].name === byEmail[0].email) {
          updates.name = name;
        }
        if (!byEmail[0].avatarUrl && avatarUrl) {
          updates.avatarUrl = avatarUrl;
        }
        const [updated] = await db
          .update(usersTable)
          .set(updates)
          .where(eq(usersTable.id, byEmail[0].id))
          .returning();
        logger.info(
          { email, oldClerkId, newClerkId: clerkId, dbUserId: byEmail[0].id },
          "Rebound DB user to new Clerk identity (prior Clerk user no longer exists)",
        );
        return updated;
      }
    }

    const [newUser] = await db.insert(usersTable).values({
      clerkId,
      name,
      email,
      role,
      avatarUrl,
    }).returning();
    return newUser;
  } catch (err) {
    logger.error({ err }, "Failed to sync user from Clerk");
    return null;
  }
}

export async function getOrCreateUser(clerkId: string): Promise<typeof usersTable.$inferSelect | null> {
  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
  return existing[0] ?? null;
}
