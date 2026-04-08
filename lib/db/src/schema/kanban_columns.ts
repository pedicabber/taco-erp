import { pgTable, text, serial, integer } from "drizzle-orm/pg-core";

export const kanbanColumnsTable = pgTable("kanban_columns", {
  id: serial("id").primaryKey(),
  statusKey: text("status_key").notNull().unique(),
  label: text("label").notNull(),
  hexColor: text("hex_color").notNull().default("#6B7280"),
  sortOrder: integer("sort_order").notNull().default(0),
});
