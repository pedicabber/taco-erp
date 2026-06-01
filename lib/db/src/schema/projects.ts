import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company").notNull(),
  projectId: text("project_id").notNull(),
  description: text("description"),
  fullDescription: text("full_description"),
  startDate: text("start_date"),
  status: text("status").notNull().default("active"),
  address: text("address"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  totalPrice: text("total_price"),
  deliveryDate: text("delivery_date"),
  scopeOfWork: text("scope_of_work"),
  notes: text("notes"),
  priority: text("priority").notNull().default("medium"),
  // Baseline (original commitment, set once at create, never moved by edits)
  baselineStartDate: text("baseline_start_date"),
  baselineDeliveryDate: text("baseline_delivery_date"),
  // Active (operational reality, what calendars/boards consume)
  activeStartDate: text("active_start_date"),
  activeDeliveryDate: text("active_delivery_date"),
  // Drift = activeDeliveryDate - baselineDeliveryDate in days (denormalized for cheap sort/filter)
  scheduleDriftDays: integer("schedule_drift_days").notNull().default(0),
  // One of: customer_delay | engineering_revision | vendor_delay | internal_capacity
  //        | quality_issue | scope_change | other  (or null if never rescheduled)
  delayReason: text("delay_reason"),
  delayNotes: text("delay_notes"),
  createdById: integer("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
