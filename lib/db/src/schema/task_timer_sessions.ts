import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taskTimerSessionsTable = pgTable("task_timer_sessions", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  startedById: integer("started_by_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
});

export const insertTaskTimerSessionSchema = createInsertSchema(taskTimerSessionsTable).omit({ id: true });
export type InsertTaskTimerSession = z.infer<typeof insertTaskTimerSessionSchema>;
export type TaskTimerSession = typeof taskTimerSessionsTable.$inferSelect;
