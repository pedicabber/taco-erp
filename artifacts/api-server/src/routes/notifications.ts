import { Router, type IRouter } from "express";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { syncUserFromClerk } from "../lib/userSync";
import {
  ListNotificationsResponse,
  MarkNotificationReadResponse,
  MarkAllNotificationsReadResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function buildNotification(n: typeof notificationsTable.$inferSelect) {
  return {
    id: n.id,
    userId: n.userId,
    taskId: n.taskId,
    type: n.type as "overdue" | "assigned" | "mentioned" | "status_changed" | "timer_alert" | "followed",
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  };
}

router.get("/notifications", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, user.id))
    .orderBy(notificationsTable.createdAt);

  res.json(ListNotificationsResponse.parse(notifications.map(buildNotification)));
});

router.patch("/notifications/:notificationId/read", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(Array.isArray(req.params.notificationId) ? req.params.notificationId[0] : req.params.notificationId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid notification ID" });
    return;
  }

  const [updated] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, user.id)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  res.json(MarkNotificationReadResponse.parse(buildNotification(updated)));
});

router.patch("/notifications/read-all", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const updated = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.isRead, false)))
    .returning();

  res.json(MarkAllNotificationsReadResponse.parse({ count: updated.length }));
});

export async function createNotification(
  userId: number,
  taskId: number | null,
  type: string,
  message: string
): Promise<void> {
  await db.insert(notificationsTable).values({ userId, taskId, type, message });
}

export default router;
