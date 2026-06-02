import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Attachments linked to a LOTO record (photos of applied locks/tags, isolation
 * point diagrams, permits, etc.). Mirrors project_attachments: objects live in
 * object storage and only their metadata + path are stored here.
 */
export const lotoAttachmentsTable = pgTable("loto_attachments", {
  id: serial("id").primaryKey(),
  lotoId: integer("loto_id").notNull(),
  fileName: text("file_name").notNull(),
  objectPath: text("object_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  uploadedById: integer("uploaded_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLotoAttachmentSchema = createInsertSchema(lotoAttachmentsTable).omit({ id: true, createdAt: true });
export type InsertLotoAttachment = z.infer<typeof insertLotoAttachmentSchema>;
export type LotoAttachment = typeof lotoAttachmentsTable.$inferSelect;
