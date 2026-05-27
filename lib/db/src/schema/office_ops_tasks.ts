import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Office Ops tasks are persistent operational checklist rows.
 *
 * Recurring tasks (recurrence != 'none') are SINGLE ROWS that are dynamically
 * interpreted against the current recurrence cycle (today / this ISO week /
 * this calendar month, all UTC). Completing a recurring task only updates
 * `status` + `completedAt`; it NEVER inserts another row. The next cycle
 * implicitly reactivates the row when `completedAt < currentCycleStart`.
 *
 * One-time tasks (recurrence='none') behave traditionally: complete once,
 * move to the Completed tab, no resurrection.
 */
export const officeOpsTasksTable = pgTable("office_ops_tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("open"),
  assigneeId: integer("assignee_id"),
  createdById: integer("created_by_id").notNull(),
  dueDate: text("due_date"),
  // Last time this row was marked completed (UTC). For recurring tasks this
  // is the cycle-completion timestamp; cycle reset is implicit on date change.
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recurrence: text("recurrence").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOfficeOpsTaskSchema = createInsertSchema(officeOpsTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOfficeOpsTask = z.infer<typeof insertOfficeOpsTaskSchema>;
export type OfficeOpsTask = typeof officeOpsTasksTable.$inferSelect;
