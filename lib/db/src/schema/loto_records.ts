import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Lockout/Tagout (LOTO) records — the core of the Safety module.
 *
 * Lifecycle (status):
 *   draft            → being prepared; the 6-section checklist is editable.
 *   active           → all 6 checklist sections complete + commander assigned;
 *                      energy is isolated and work is underway. Immutable fields.
 *   pending_release  → a release has been requested; awaiting the assigned LOTO
 *                      Commander's authorization.
 *   closed           → released/authorized. PERMANENTLY IMMUTABLE. Corrections
 *                      are only ever appended as admin audit notes (loto_events).
 *
 * The checklist is stored as JSON so the module can evolve its sections without
 * a migration. Section titles are server-authoritative; only `complete`/`notes`
 * are caller-editable while the record is in draft.
 */
export type LotoChecklistSection = {
  key: string;
  title: string;
  complete: boolean;
  notes: string | null;
};

export const lotoRecordsTable = pgTable("loto_records", {
  id: serial("id").primaryKey(),
  // Human-facing identifier, e.g. "LOTO-0001". Assigned right after insert.
  lotoNumber: text("loto_number").notNull().default(""),
  projectId: integer("project_id").notNull(),
  equipmentName: text("equipment_name").notNull(),
  equipmentLocation: text("equipment_location"),
  description: text("description"),
  // standard | critical — critical drives the "Critical-active" dashboard card.
  severity: text("severity").notNull().default("standard"),
  // draft | active | pending_release | closed
  status: text("status").notNull().default("draft"),
  // The LOTO Commander assigned to gate release. A per-record user reference,
  // not a global role.
  commanderId: integer("commander_id"),
  checklist: jsonb("checklist").$type<LotoChecklistSection[]>().notNull().default([]),
  createdById: integer("created_by_id").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  releaseRequestedAt: timestamp("release_requested_at", { withTimezone: true }),
  releaseRequestedById: integer("release_requested_by_id"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedById: integer("closed_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLotoRecordSchema = createInsertSchema(lotoRecordsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLotoRecord = z.infer<typeof insertLotoRecordSchema>;
export type LotoRecord = typeof lotoRecordsTable.$inferSelect;
