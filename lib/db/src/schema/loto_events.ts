import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Permanent, append-only audit trail for a LOTO record. Every lifecycle
 * transition writes an event here, and admins can append correction notes
 * (`audit_note`) even after a record is closed — closed records are otherwise
 * immutable, so this table is the only sanctioned way to annotate them.
 *
 * type: created | activated | release_requested | release_authorized
 *     | release_rejected | attachment_added | attachment_removed | audit_note
 */
export const lotoEventsTable = pgTable("loto_events", {
  id: serial("id").primaryKey(),
  lotoId: integer("loto_id").notNull(),
  type: text("type").notNull(),
  message: text("message"),
  actorId: integer("actor_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLotoEventSchema = createInsertSchema(lotoEventsTable).omit({ id: true, createdAt: true });
export type InsertLotoEvent = z.infer<typeof insertLotoEventSchema>;
export type LotoEvent = typeof lotoEventsTable.$inferSelect;
