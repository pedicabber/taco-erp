import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const officeOpsTasksTable = pgTable("office_ops_tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("open"),
  assigneeId: integer("assignee_id"),
  createdById: integer("created_by_id").notNull(),
  dueDate: text("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recurrence: text("recurrence").notNull().default("none"),
  recurrenceAnchorDate: text("recurrence_anchor_date"),
  parentRecurrenceId: integer("parent_recurrence_id"),
  // Set the first time a recurring task completes and spawns its successor.
  // Acts as a one-shot idempotency latch: once set, no further completions of
  // THIS row will spawn another occurrence. Reopening does NOT clear it, so
  // complete → reopen → complete cycles cannot duplicate the chain.
  nextInstanceId: integer("next_instance_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOfficeOpsTaskSchema = createInsertSchema(officeOpsTasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOfficeOpsTask = z.infer<typeof insertOfficeOpsTaskSchema>;
export type OfficeOpsTask = typeof officeOpsTasksTable.$inferSelect;
