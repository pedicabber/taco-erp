import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Lockout/Tagout (LOTO) records — the core of the Safety module.
 *
 * Lifecycle (status):
 *   draft            → being prepared; the 6-section checklist + personnel are
 *                      editable.
 *   active           → all 6 checklist sections complete + commander assigned;
 *                      energy is isolated and work is underway (the "Work
 *                      Phase"). Notes/issues/photos/personnel may still be added.
 *   pending_review   → a release has been requested with the Request-Release
 *                      checklist; awaiting the assigned LOTO Commander's review
 *                      and energization authorization. (UI label: "Pending
 *                      Commander Review".)
 *   closed           → released, authorized, and closed out. PERMANENTLY
 *                      IMMUTABLE. Corrections are only ever appended as admin
 *                      audit notes (loto_events).
 *
 * The 6-section isolation checklist is stored as JSON so the module can evolve
 * its sections without a migration. Section titles are server-authoritative;
 * only `complete`/`notes` are caller-editable while the record is in draft.
 */
export type LotoChecklistSection = {
  key: string;
  title: string;
  complete: boolean;
  notes: string | null;
};

/**
 * The Request-Release checklist a technician confirms before a release is sent
 * to the commander. Captured once, at request-release time, then immutable.
 */
export type LotoReleaseChecklist = {
  workComplete: boolean;
  toolsRemoved: boolean;
  guardsInstalled: boolean;
  areaCleaned: boolean;
  personnelClear: boolean;
  note: string | null;
};

export const lotoRecordsTable = pgTable("loto_records", {
  id: serial("id").primaryKey(),
  // Human-facing identifier, e.g. "LOTO-0001". Assigned right after insert.
  lotoNumber: text("loto_number").notNull().default(""),
  projectId: integer("project_id").notNull(),
  equipmentName: text("equipment_name").notNull(),
  equipmentLocation: text("equipment_location"),
  description: text("description"),
  // low | medium | high | critical — "critical" drives the Critical-active card.
  severity: text("severity").notNull().default("medium"),
  // draft | active | pending_review | closed
  status: text("status").notNull().default("draft"),
  // The LOTO Commander assigned to gate release. A per-record user reference,
  // not a global role.
  commanderId: integer("commander_id"),
  // The person who physically applied the lock(s).
  lockedOutById: integer("locked_out_by_id"),
  // Additional personnel involved (user ids). Editable while draft/active.
  additionalPersonnel: jsonb("additional_personnel").$type<number[]>().notNull().default([]),
  checklist: jsonb("checklist").$type<LotoChecklistSection[]>().notNull().default([]),
  createdById: integer("created_by_id").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  // ── Request-Release ─────────────────────────────────────────────────────────
  releaseRequestedAt: timestamp("release_requested_at", { withTimezone: true }),
  releaseRequestedById: integer("release_requested_by_id"),
  releaseChecklist: jsonb("release_checklist").$type<LotoReleaseChecklist | null>(),
  // ── Commander Review ────────────────────────────────────────────────────────
  // reviewDecision: approved | rejected (rejected returns the record to active).
  reviewDecision: text("review_decision"),
  reviewComments: text("review_comments"),
  reviewedById: integer("reviewed_by_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // ── Authorize Energization (records who authorized re-energization, when) ────
  authorizedById: integer("authorized_by_id"),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }),
  authorizationComments: text("authorization_comments"),
  // ── Closeout ────────────────────────────────────────────────────────────────
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedById: integer("closed_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLotoRecordSchema = createInsertSchema(lotoRecordsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLotoRecord = z.infer<typeof insertLotoRecordSchema>;
export type LotoRecord = typeof lotoRecordsTable.$inferSelect;
