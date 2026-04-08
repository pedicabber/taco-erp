import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taskRelationsTable = pgTable("task_relations", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  relatedTaskId: integer("related_task_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskRelationSchema = createInsertSchema(taskRelationsTable).omit({ id: true, createdAt: true });
export type InsertTaskRelation = z.infer<typeof insertTaskRelationSchema>;
export type TaskRelation = typeof taskRelationsTable.$inferSelect;
