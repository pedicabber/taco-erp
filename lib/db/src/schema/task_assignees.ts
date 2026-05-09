import { pgTable, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { usersTable } from "./users";

/**
 * Secondary task assignees. The PRIMARY assignee continues to live on
 * `tasks.assignee_id`. Rows in this table are ADDITIONAL assignees only.
 * Reads should UNION the primary id with rows in this table; writes must
 * dedupe against the primary id so the same user is never stored twice
 * for one task.
 *
 * Both FKs cascade so that deleting a task or a user automatically cleans
 * out the join rows — no orphaned secondary-assignee rows can remain.
 */
export const taskAssigneesTable = pgTable(
  "task_assignees",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.taskId, t.userId] }),
  }),
);

export type TaskAssignee = typeof taskAssigneesTable.$inferSelect;
