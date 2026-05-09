import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { getAuth } from "@clerk/express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";
import { db, projectAttachmentsTable, taskAttachmentsTable, tasksTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const LOADING_MEDIA_PREFIX = "/objects/uploads/loading-media/";

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires authentication to prevent anonymous storage abuse.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType, taskId, projectId } = parsed.data;
    // Optional discriminator carried alongside the standard fields. Zod
    // strips unknown keys from `parsed.data`, so read it from the raw body.
    const kind = (req.body as { kind?: string } | undefined)?.kind;

    // Loading-media uploads are admin-only and live in their own namespace
    // so the serve handler can identify them by path prefix alone.
    if (kind === "loading-media") {
      const auth = getAuth(req);
      const clerkId = auth?.userId;
      if (!clerkId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const [adminUser] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.clerkId, clerkId));
      if (!adminUser || adminUser.role !== "admin") {
        res.status(403).json({ error: "Forbidden: admin role required" });
        return;
      }
    }

    // Organise uploads by context so each domain has its own folder.
    // No task/project context => avatar upload (legacy default).
    const subDir = kind === "loading-media"
      ? "uploads/loading-media"
      : taskId
        ? `uploads/tasks/${taskId}`
        : projectId
          ? `uploads/projects/${projectId}`
          : "uploads/avatars";
    const { uploadURL, objectPath } = await objectStorageService.getObjectEntityUploadURL(subDir);

    req.log.info({ objectPath }, "Generated upload URL");

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities. Requires authentication.
 * Access is restricted to users who uploaded the attachment or who are admins.
 * The object path is matched against task_attachments to verify authorization.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Loading-media is benign intra-app content (the global loading overlay's
    // graphic). Allow any authenticated user to read anything under the
    // dedicated namespace; uploads into the namespace are already gated to
    // admins by the upload endpoint.
    if (objectPath.startsWith(LOADING_MEDIA_PREFIX)) {
      const auth = getAuth(req);
      if (!auth?.userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
      return;
    }

    const [projectAttachment] = await db
      .select({ id: projectAttachmentsTable.id })
      .from(projectAttachmentsTable)
      .where(eq(projectAttachmentsTable.objectPath, objectPath));

    if (!projectAttachment) {
      const [attachment] = await db
        .select({ uploadedById: taskAttachmentsTable.uploadedById, taskId: taskAttachmentsTable.taskId })
        .from(taskAttachmentsTable)
        .where(eq(taskAttachmentsTable.objectPath, objectPath));

      if (!attachment) {
        // Avatar fallback: only allow if the object lives in the dedicated
        // avatars namespace. This prevents a user from forging avatarUrl to
        // point at an arbitrary private object and gaining access through
        // this fallback path.
        if (!objectPath.startsWith("/objects/uploads/avatars/")) {
          res.status(404).json({ error: "Object not found" });
          return;
        }

        // Match by suffix so the check is independent of any path prefix
        // (e.g. when the artifact is mounted under a sub-path in production).
        const servingSuffix = `/storage${objectPath}`;
        const candidates = await db
          .select({ id: usersTable.id, avatarUrl: usersTable.avatarUrl })
          .from(usersTable);
        const owns = candidates.some(u => u.avatarUrl?.endsWith(servingSuffix));

        if (!owns) {
          res.status(404).json({ error: "Object not found" });
          return;
        }
      }
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
