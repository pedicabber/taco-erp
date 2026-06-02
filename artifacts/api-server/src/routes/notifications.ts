import { Router, type IRouter } from "express";
import { db, notificationsTable, usersTable, departmentsTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { syncUserFromClerk } from "../lib/userSync";
import {
  ListNotificationsResponse,
  MarkNotificationReadResponse,
  MarkAllNotificationsReadResponse,
  CreateGeneralNotificationBody,
  ListSentNotificationsResponse,
  ListSentNotificationsResponseItem,
} from "@workspace/api-zod";

const router: IRouter = Router();

type NotificationRow = typeof notificationsTable.$inferSelect;

function buildNotification(n: NotificationRow, senderName: string | null = null) {
  return {
    id: n.id,
    userId: n.userId,
    taskId: n.taskId,
    type: n.type as
      | "overdue"
      | "assigned"
      | "mentioned"
      | "status_changed"
      | "timer_alert"
      | "followed"
      | "general"
      | "loto_release_request",
    message: n.message,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
    senderId: n.senderId,
    senderName,
    title: n.title,
    broadcastId: n.broadcastId,
    linkPath: n.linkPath,
  };
}

router.get("/notifications", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rows = await db
    .select({
      n: notificationsTable,
      senderName: usersTable.name,
    })
    .from(notificationsTable)
    .leftJoin(usersTable, eq(usersTable.id, notificationsTable.senderId))
    .where(eq(notificationsTable.userId, user.id))
    .orderBy(desc(notificationsTable.createdAt));

  res.json(ListNotificationsResponse.parse(rows.map(r => buildNotification(r.n, r.senderName ?? null))));
});

// Sent must be declared before /:notificationId/read so it isn't shadowed.
router.get("/notifications/sent", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = await syncUserFromClerk(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rows = await db
    .select({
      id: notificationsTable.id,
      broadcastId: notificationsTable.broadcastId,
      title: notificationsTable.title,
      message: notificationsTable.message,
      createdAt: notificationsTable.createdAt,
      recipientId: notificationsTable.userId,
      recipientName: usersTable.name,
      recipientAvatar: usersTable.avatarUrl,
      recipientDeptName: departmentsTable.name,
    })
    .from(notificationsTable)
    .leftJoin(usersTable, eq(usersTable.id, notificationsTable.userId))
    .leftJoin(departmentsTable, eq(departmentsTable.id, usersTable.departmentId))
    .where(and(eq(notificationsTable.senderId, user.id), eq(notificationsTable.type, "general")))
    .orderBy(desc(notificationsTable.createdAt));

  // Group by broadcastId. Rows without a broadcastId (legacy/edge case) are
  // grouped per-row using their notification id as a synthetic key so they
  // still render.
  const groups = new Map<string, {
    broadcastId: string;
    title: string | null;
    message: string;
    createdAt: Date;
    recipients: { id: number; name: string; avatarUrl: string | null; departmentName: string | null }[];
  }>();

  for (const r of rows) {
    const key = r.broadcastId ?? `single:${r.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        broadcastId: r.broadcastId ?? `single:${r.id}`,
        title: r.title,
        message: r.message,
        createdAt: r.createdAt,
        recipients: [],
      };
      groups.set(key, g);
    }
    g.recipients.push({
      id: r.recipientId,
      name: r.recipientName ?? "Unknown",
      avatarUrl: r.recipientAvatar ?? null,
      departmentName: r.recipientDeptName ?? null,
    });
  }

  const broadcasts = Array.from(groups.values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(g => ({
      broadcastId: g.broadcastId,
      title: g.title,
      message: g.message,
      createdAt: g.createdAt.toISOString(),
      recipientCount: g.recipients.length,
      recipients: g.recipients,
    }));

  res.json(ListSentNotificationsResponse.parse(broadcasts));
});

router.post("/notifications", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res): Promise<void> => {
  const sender = await syncUserFromClerk(req);
  if (!sender) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = CreateGeneralNotificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const { title, message, recipientUserIds } = parsed.data;

  // Dedupe + validate recipients exist.
  const uniqueIds = Array.from(new Set(recipientUserIds));
  if (uniqueIds.length === 0) {
    res.status(400).json({ error: "At least one recipient is required" });
    return;
  }

  const recipients = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
      departmentName: departmentsTable.name,
    })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(departmentsTable.id, usersTable.departmentId))
    .where(inArray(usersTable.id, uniqueIds));

  if (recipients.length === 0) {
    res.status(400).json({ error: "No valid recipients found" });
    return;
  }

  const broadcastId = randomUUID();
  const now = new Date();

  await db.insert(notificationsTable).values(
    recipients.map(r => ({
      userId: r.id,
      taskId: null,
      type: "general",
      message,
      isRead: false,
      senderId: sender.id,
      title: title ?? null,
      broadcastId,
    }))
  );

  res.status(201).json(
    ListSentNotificationsResponseItem.parse({
      broadcastId,
      title: title ?? null,
      message,
      createdAt: now.toISOString(),
      recipientCount: recipients.length,
      recipients: recipients.map(r => ({
        id: r.id,
        name: r.name,
        avatarUrl: r.avatarUrl ?? null,
        departmentName: r.departmentName ?? null,
      })),
    })
  );
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
  message: string,
  linkPath: string | null = null
): Promise<void> {
  await db.insert(notificationsTable).values({ userId, taskId, type, message, linkPath });
}

export default router;
