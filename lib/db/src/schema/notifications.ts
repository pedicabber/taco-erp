import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  taskId: integer("task_id"),
  type: text("type").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Manually-created "general" notifications carry the sender's user id so the
  // recipient can see who it came from and the sender can list their own
  // outbound notifications. System-generated notifications (overdue, assigned,
  // status_changed, timer_alert, followed, mentioned) leave this NULL — that
  // preserves all existing rows and the existing createNotification() call
  // sites without modification.
  senderId: integer("sender_id").references(() => usersTable.id, { onDelete: "set null" }),
  // Optional subject line for general notifications. NULL for system rows.
  title: text("title"),
  // Groups every per-recipient row produced by a single "Send" action so the
  // Sent tab can collapse them to one entry per broadcast (with an aggregate
  // recipient count). NULL for system rows.
  broadcastId: text("broadcast_id"),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
