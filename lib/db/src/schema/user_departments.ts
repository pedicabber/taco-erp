import { pgTable, integer, primaryKey } from "drizzle-orm/pg-core";

export const userDepartmentsTable = pgTable("user_departments", {
  userId: integer("user_id").notNull(),
  departmentId: integer("department_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.departmentId] }),
]);
