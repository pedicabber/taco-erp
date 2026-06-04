import { pgTable, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taskTimerSessionsTable = pgTable("task_timer_sessions", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  startedById: integer("started_by_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  // Original clock-in/out captured ONCE on the first edit (manual or auto), so
  // the corrected timestamps live in startedAt/stoppedAt while the untouched
  // values remain visible for the audit trail. NULL means "never edited".
  originalStartedAt: timestamp("original_started_at", { withTimezone: true }),
  originalStoppedAt: timestamp("original_stopped_at", { withTimezone: true }),
  // True when a user manually changed the clock-in/out times.
  edited: boolean("edited").notNull().default(false),
  // True when the end-of-day scheduler force-closed this still-open entry at
  // 9:00 PM Pacific Time (America/Los_Angeles).
  autoClockedOut: boolean("auto_clocked_out").notNull().default(false),
});

export const insertTaskTimerSessionSchema = createInsertSchema(taskTimerSessionsTable).omit({ id: true });
export type InsertTaskTimerSession = z.infer<typeof insertTaskTimerSessionSchema>;
export type TaskTimerSession = typeof taskTimerSessionsTable.$inferSelect;
