import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  quantity: real("quantity").notNull().default(0),
  unit: text("unit").notNull().default("ea"),
  unitCost: text("unit_cost"),
  supplier: text("supplier"),
  location: text("location"),
  minQty: real("min_qty").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;

export const inventoryAllocationsTable = pgTable("inventory_allocations", {
  id: serial("id").primaryKey(),
  inventoryItemId: integer("inventory_item_id").notNull(),
  projectId: integer("project_id").notNull(),
  quantity: real("quantity").notNull(),
  notes: text("notes"),
  allocatedById: integer("allocated_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInventoryAllocationSchema = createInsertSchema(inventoryAllocationsTable).omit({ id: true, createdAt: true });
export type InsertInventoryAllocation = z.infer<typeof insertInventoryAllocationSchema>;
export type InventoryAllocation = typeof inventoryAllocationsTable.$inferSelect;
