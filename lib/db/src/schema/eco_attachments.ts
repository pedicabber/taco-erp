import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ecoAttachmentsTable = pgTable("eco_attachments", {
  id: serial("id").primaryKey(),
  ecoId: integer("eco_id").notNull(),
  projectId: integer("project_id").notNull(),
  fileName: text("file_name").notNull(),
  objectPath: text("object_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  uploadedById: integer("uploaded_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEcoAttachmentSchema = createInsertSchema(ecoAttachmentsTable).omit({ id: true, createdAt: true });
export type InsertEcoAttachment = z.infer<typeof insertEcoAttachmentSchema>;
export type EcoAttachment = typeof ecoAttachmentsTable.$inferSelect;
