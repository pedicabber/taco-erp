import { getAuth } from "@clerk/express";
import { clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import type { Request } from "express";

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

    const [newUser] = await db.insert(usersTable).values({
      clerkId,
      name,
      email,
      role: "member",
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
