import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectAttachmentsTable = pgTable("project_attachments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  fileName: text("file_name").notNull(),
  objectPath: text("object_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  isPinned: boolean("is_pinned").notNull().default(false),
  uploadedById: integer("uploaded_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProjectAttachmentSchema = createInsertSchema(projectAttachmentsTable).omit({ id: true, createdAt: true });
export type InsertProjectAttachment = z.infer<typeof insertProjectAttachmentSchema>;
export type ProjectAttachment = typeof projectAttachmentsTable.$inferSelect;
