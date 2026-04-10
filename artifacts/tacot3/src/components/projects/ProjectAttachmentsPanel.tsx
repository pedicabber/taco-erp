import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import type { ProjectAttachment, TaskAttachment, ProjectAllAttachments, ProjectAllAttachmentsTaskGroup } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Paperclip, Upload, Loader2, FileText, File, Image,
  Eye, Download, Trash2, ChevronDown, ChevronRight, Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";

function getFileUrl(objectPath: string) {
  return `/api/storage/objects${objectPath.replace(/^\/objects/, "")}`;
}

type FileKind = "image" | "pdf" | "other";
function fileKind(fileName: string, mimeType?: string | null): FileKind {
  const mime = mimeType ?? "";
  const name = fileName.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(name)) return "image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  return "other";
}

function FileIcon({ kind, className }: { kind: FileKind; className?: string }) {
  if (kind === "image") return <Image className={cn("text-blue-500", className)} />;
  if (kind === "pdf") return <FileText className={cn("text-red-500", className)} />;
  return <File className={cn("text-muted-foreground", className)} />;
}

function formatSize(bytes: number | null | undefined) {
  if (!bytes) return null;
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

interface PreviewState {
  url: string;
  fileName: string;
  kind: FileKind;
}

function AttachmentRow({
  fileName,
  objectPath,
  fileSize,
  mimeType,
  isPinned,
  onPreview,
  onDownload,
  onDelete,
}: {
  fileName: string;
  objectPath: string;
  fileSize?: number | null;
  mimeType?: string | null;
  isPinned?: boolean;
  onPreview?: () => void;
  onDownload: () => void;
  onDelete?: () => void;
}) {
  const kind = fileKind(fileName, mimeType);
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 transition-colors">
      <FileIcon kind={kind} className="w-8 h-8 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm truncate">{fileName}</span>
          {isPinned && (
            <Badge variant="outline" className="text-xs py-0 px-1.5 gap-0.5 flex-shrink-0">
              <Pin className="w-2.5 h-2.5" />
              pinned
            </Badge>
          )}
        </div>
        {formatSize(fileSize) && (
          <div className="text-xs text-muted-foreground">{formatSize(fileSize)}</div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {(kind === "image" || kind === "pdf") && onPreview && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPreview}>
            <Eye className="w-4 h-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDownload} asChild>
          <a href={getFileUrl(objectPath)} download={fileName}>
            <Download className="w-4 h-4" />
          </a>
        </Button>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/60 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-medium flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          {title}
          <Badge variant="secondary" className="text-xs py-0 px-1.5">{count}</Badge>
        </span>
      </button>
      {open && (
        <div className="p-2 space-y-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

interface Props {
  projectId: number;
}

export default function ProjectAttachmentsPanel({ projectId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<ProjectAllAttachments>({
    queryKey: ["project-all-attachments", projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/all-attachments`).then(r => r.data),
  });

  const deleteProjectAttachment = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/projects/${projectId}/attachments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-all-attachments", projectId] });
      toast({ title: "Attachment deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  async function uploadProjectFile(file: File, pinned = false) {
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "File too large", description: "Maximum is 50 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const urlRes = await apiClient.post("/storage/uploads/request-url", {
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
      });
      const { uploadURL, objectPath } = urlRes.data;

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!putRes.ok) throw new Error(`Storage PUT failed: ${putRes.status}`);

      await apiClient.post(`/projects/${projectId}/attachments`, {
        fileName: file.name,
        objectPath,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        isPinned: pinned,
      });

      qc.invalidateQueries({ queryKey: ["project-all-attachments", projectId] });
      toast({ title: "Uploaded", description: file.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    uploadProjectFile(file);
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadProjectFile(file);
  }, [projectId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragging(false), []);

  const projectAttachments: ProjectAttachment[] = data?.projectAttachments ?? [];
  const taskGroups: ProjectAllAttachmentsTaskGroup[] = data?.taskGroups ?? [];
  const topLevelGroups = taskGroups.filter(g => !g.isSubtask);
  const subtaskGroups = taskGroups.filter(g => g.isSubtask);

  const totalCount =
    projectAttachments.length +
    taskGroups.reduce((sum, g) => sum + g.attachments.length, 0);

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="w-4 h-4" />
              Project Attachments
              {totalCount > 0 && (
                <Badge variant="secondary" className="text-xs">{totalCount}</Badge>
              )}
            </CardTitle>
            <Label htmlFor="proj-file-upload" className="cursor-pointer">
              <Button variant="outline" size="sm" asChild>
                <span>
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : (
                    <Upload className="w-4 h-4 mr-1" />
                  )}
                  Upload
                </span>
              </Button>
            </Label>
            <Input
              id="proj-file-upload"
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileInput}
              disabled={uploading}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-lg py-4 text-center text-sm text-muted-foreground cursor-pointer transition-colors",
              dragging ? "border-primary bg-primary/5 text-primary" : "hover:border-muted-foreground/50"
            )}
          >
            <Upload className="w-5 h-5 mx-auto mb-1" />
            {dragging ? "Drop file here" : "Drop files here or click to upload"}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : totalCount === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">No attachments yet</p>
          ) : (
            <div className="space-y-2">
              {/* Project-level files */}
              {projectAttachments.length > 0 && (
                <CollapsibleSection title="Project Assets" count={projectAttachments.length} defaultOpen>
                  {/* pinned first */}
                  {[...projectAttachments].sort((a, b) => Number(b.isPinned) - Number(a.isPinned)).map((a: ProjectAttachment) => (
                    <AttachmentRow
                      key={a.id}
                      fileName={a.fileName}
                      objectPath={a.objectPath}
                      fileSize={a.fileSize}
                      mimeType={a.mimeType}
                      isPinned={a.isPinned}
                      onPreview={() => setPreview({ url: getFileUrl(a.objectPath), fileName: a.fileName, kind: fileKind(a.fileName, a.mimeType) })}
                      onDownload={() => {}}
                      onDelete={() => deleteProjectAttachment.mutate(a.id)}
                    />
                  ))}
                </CollapsibleSection>
              )}

              {/* Top-level task files */}
              {topLevelGroups.map(group => (
                <CollapsibleSection
                  key={group.taskId}
                  title={`Task: ${group.taskTitle}`}
                  count={group.attachments.length}
                  defaultOpen={false}
                >
                  {group.attachments.map((a: TaskAttachment) => (
                    <AttachmentRow
                      key={a.id}
                      fileName={a.fileName}
                      objectPath={a.objectPath}
                      fileSize={a.fileSize}
                      mimeType={a.mimeType}
                      onPreview={() => setPreview({ url: getFileUrl(a.objectPath), fileName: a.fileName, kind: fileKind(a.fileName, a.mimeType) })}
                      onDownload={() => {}}
                    />
                  ))}
                </CollapsibleSection>
              ))}

              {/* Subtask files */}
              {subtaskGroups.map(group => (
                <CollapsibleSection
                  key={group.taskId}
                  title={`Subtask: ${group.taskTitle}`}
                  count={group.attachments.length}
                  defaultOpen={false}
                >
                  {group.parentTaskTitle && (
                    <p className="text-xs text-muted-foreground px-1 pb-1">
                      Part of: {group.parentTaskTitle}
                    </p>
                  )}
                  {group.attachments.map((a: TaskAttachment) => (
                    <AttachmentRow
                      key={a.id}
                      fileName={a.fileName}
                      objectPath={a.objectPath}
                      fileSize={a.fileSize}
                      mimeType={a.mimeType}
                      onPreview={() => setPreview({ url: getFileUrl(a.objectPath), fileName: a.fileName, kind: fileKind(a.fileName, a.mimeType) })}
                      onDownload={() => {}}
                    />
                  ))}
                </CollapsibleSection>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview dialog */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-background rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-sm font-medium truncate">{preview.fileName}</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={preview.url} download={preview.fileName}>
                    <Download className="w-4 h-4 mr-1" /> Download
                  </a>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                  Close
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center p-4">
              {preview.kind === "image" ? (
                <img src={preview.url} alt={preview.fileName} className="max-w-full max-h-full object-contain" />
              ) : preview.kind === "pdf" ? (
                <iframe src={preview.url} className="w-full h-[75vh] border-0 rounded" title={preview.fileName} />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
