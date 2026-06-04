import { pgTable, serial, integer, timestamp, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Immutable audit trail for time-entry (task_timer_sessions) changes. Rows are
 * only ever inserted — never updated or deleted — so the full history of every
 * manual edit and every automatic end-of-day clock-out is preserved.
 *
 * editType:
 *   - "edit"           a user manually changed the clock-in/out times.
 *   - "auto_clock_out" the end-of-day scheduler force-closed an open entry at
 *                      9:00 PM Pacific Time (America/Los_Angeles).
 *
 * editedById is NULL for system-generated auto clock-outs (no human actor).
 */
export const timeEntryEditsTable = pgTable("time_entry_edits", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  taskId: integer("task_id").notNull(),
  editedById: integer("edited_by_id"),
  editType: text("edit_type").notNull(),
  originalStartedAt: timestamp("original_started_at", { withTimezone: true }),
  updatedStartedAt: timestamp("updated_started_at", { withTimezone: true }),
  originalStoppedAt: timestamp("original_stopped_at", { withTimezone: true }),
  updatedStoppedAt: timestamp("updated_stopped_at", { withTimezone: true }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTimeEntryEditSchema = createInsertSchema(timeEntryEditsTable).omit({ id: true, createdAt: true });
export type InsertTimeEntryEdit = z.infer<typeof insertTimeEntryEditSchema>;
export type TimeEntryEdit = typeof timeEntryEditsTable.$inferSelect;
