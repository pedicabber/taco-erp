import { pgTable, text, serial, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One of: customer_request | internal_improvement | correction
//        | scope_addition | scope_reduction
// One of status: draft | approved | implemented | cancelled | rejected
// One of customerApproved: yes | no | pending
export const engineeringChangeOrdersTable = pgTable("engineering_change_orders", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  // Per-project sequence used to derive the human ECO number (ECO-001, ...).
  seq: integer("seq").notNull(),
  ecoNumber: text("eco_number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  ecoType: text("eco_type").notNull().default("customer_request"),
  // Cost impact stored as integer cents (supports positive / negative / zero).
  costImpactCents: integer("cost_impact_cents").notNull().default(0),
  // Schedule impact in days (0 = none). Weeks presets are converted to days in UI.
  leadTimeImpactDays: integer("lead_time_impact_days").notNull().default(0),
  customerApproved: text("customer_approved").notNull().default("pending"),
  status: text("status").notNull().default("draft"),
  // Date-only (YYYY-MM-DD) recorded when the ECO is marked Approved.
  approvalDate: text("approval_date"),
  createdById: integer("created_by_id").notNull(),
  lastModifiedById: integer("last_modified_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  // Per-project sequence (and derived ECO number) must be unique so concurrent
  // creates can never produce duplicate ECO numbers.
  projectSeqUnique: unique("eco_project_seq_unique").on(t.projectId, t.seq),
}));

export const insertEcoSchema = createInsertSchema(engineeringChangeOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEco = z.infer<typeof insertEcoSchema>;
export type Eco = typeof engineeringChangeOrdersTable.$inferSelect;
