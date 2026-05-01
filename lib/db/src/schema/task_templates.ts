import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const taskTemplatesTable = pgTable("task_templates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  departmentId: integer("department_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskTemplateSubtasksTable = pgTable("task_template_subtasks", {
  id: serial("id").primaryKey(),
  taskTemplateId: integer("task_template_id").notNull(),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type TaskTemplate = typeof taskTemplatesTable.$inferSelect;
export type TaskTemplateSubtask = typeof taskTemplateSubtasksTable.$inferSelect;
