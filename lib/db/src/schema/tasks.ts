import { pgTable, text, serial, timestamp, integer, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("backlog"),
  priority: text("priority").notNull().default("medium"),
  projectId: integer("project_id").notNull(),
  departmentId: integer("department_id"),
  assigneeId: integer("assignee_id"),
  assignerId: integer("assigner_id"),
  followerIds: integer("follower_ids").array().notNull().default([]),
  expectedHours: real("expected_hours"),
  dueDate: text("due_date"),
  startDate: text("start_date"),
  elapsedSeconds: integer("elapsed_seconds").notNull().default(0),
  timerRunning: boolean("timer_running").notNull().default(false),
  timerStartedAt: timestamp("timer_started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
