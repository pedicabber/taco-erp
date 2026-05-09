import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import type {
  UserProfileMini,
  TaskAttachment,
  ProjectAttachment,
  Department,
  Project,
} from "@/lib/types";
import {
  ArrowLeft,
  Play,
  Square,
  Clock,
  Edit2,
  Trash2,
  Save,
  X,
  Paperclip,
  Bell,
  BellOff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  User,
  Building2,
  Upload,
  FileText,
  Tag,
  Eye,
  Download,
  File,
  ChevronRight,
  ChevronDown,
  Pin,
  Image,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useLiveTimer } from "@/hooks/useLiveTimer";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

/** Parse a date-only string (YYYY-MM-DD) as LOCAL midnight, not UTC midnight. */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const STATUS_STYLES: Record<string, string> = {
  backlog: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  in_review:
    "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  on_hold: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  complete: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  in_review: "In Review",
  on_hold: "On Hold",
  blocked: "Blocked",
  complete: "Completed",
  new_tasks: "New Tasks",
  cancelled: "Cancelled",
};

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function TimerBar({
  elapsed,
  expectedHours,
}: {
  elapsed: number;
  expectedHours: number | null;
}) {
  if (!expectedHours) return null;
  const pct = Math.min(100, (elapsed / (expectedHours * 3600)) * 100);
  const isOver = pct >= 100;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">Progress vs expected</span>
        <span
          className={
            isOver ? "text-orange-500 font-semibold" : "text-muted-foreground"
          }
        >
          {pct.toFixed(0)}% of {expectedHours}h
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isOver ? "bg-orange-500" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}


function AttachmentSection({
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
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-sm font-medium flex items-center gap-2">
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          {title}
          <Badge variant="secondary" className="text-xs py-0 px-1.5">
            {count}
          </Badge>
        </span>
      </button>
      {open && <div className="p-2 space-y-1.5">{children}</div>}
    </div>
  );
}

function SqdcNotesInput({
  task,
  onSave,
}: {
  task: { costMaterialNotes?: string | null };
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(task.costMaterialNotes ?? "");
  useEffect(() => { setValue(task.costMaterialNotes ?? ""); }, [task.costMaterialNotes]);
  return (
    <Textarea
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={() => onSave(value)}
      placeholder="Add notes on cost variances or materials…"
      rows={2}
      className="text-sm resize-none"
    />
  );
}

interface TimerSession {
  id: number;
  taskId: number;
  startedById: number;
  startedBy: {
    id: number;
    name: string;
    avatarUrl: string | null;
  };
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
}

export default function TaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = parseInt(params.taskId, 10);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: currentUser } = useCurrentUser();

  type EditFormState = {
    title: string;
    description: string;
    status: string;
    priority: string;
    /** Ordered assignee user-ids; index 0 is the primary assignee. */
    assigneeIds: number[];
    departmentId: string;
    expectedHours: string;
    startDate: string;
    dueDate: string;
  };
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editingTimer, setEditingTimer] = useState(false);
  const [timerHours, setTimerHours] = useState("");
  const [timerMins, setTimerMins] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<{
    fileName: string;
    objectPath: string;
    mimeType?: string | null;
  } | null>(null);
  const [sqdcError, setSqdcError] = useState(false);
  const sqdcCardRef = useRef<HTMLDivElement>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [timerLogOpen, setTimerLogOpen] = useState(false);

  function getFileUrl(objectPath: string) {
    return `/api/storage/objects${objectPath.replace(/^\/objects/, "")}`;
  }

  function getFileType(a: {
    fileName: string;
    mimeType?: string | null;
  }): "image" | "pdf" | "other" {
    const mime = a.mimeType ?? "";
    const name = a.fileName.toLowerCase();
    if (
      mime.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(name)
    )
      return "image";
    if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    return "other";
  }

  const { data: task, isLoading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => apiClient.get(`/tasks/${taskId}`).then((r) => r.data),
    refetchInterval: 10000,
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ["task-attachments", taskId],
    queryFn: () =>
      apiClient.get(`/tasks/${taskId}/attachments`).then((r) => r.data),
  });

  const projectId: number | null = task?.projectId ?? null;

  const { data: projectAttachments = [] } = useQuery<ProjectAttachment[]>({
    queryKey: ["project-attachments", projectId],
    queryFn: () =>
      apiClient.get(`/projects/${projectId}/attachments`).then((r) => r.data),
    enabled: !!projectId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/users").then((r) => r.data),
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["departments", "global"],
    queryFn: () =>
      apiClient.get("/departments?global=true").then((r) => r.data),
  });

  // Loads the parent project so we can render the small "Company • Project •
  // Code" context strip near the top of the task-detail page.
  const { data: project } = useQuery<Project>({
    queryKey: ["project", projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}`).then((r) => r.data),
    enabled: !!projectId,
  });

  const { data: timerSessions = [] } = useQuery<TimerSession[]>({
    queryKey: ["task-timer-sessions", taskId],
    queryFn: () =>
      apiClient.get(`/tasks/${taskId}/timer/sessions`).then((r) => r.data),
    enabled: Number.isFinite(taskId),
  });

  useEffect(() => {
    setNotesDraft(task?.notes ?? "");
  }, [task?.notes]);

  const elapsed = useLiveTimer(
    task?.elapsedSeconds ?? 0,
    task?.timerRunning ?? false,
    task?.timerStartedAt ?? null,
  );
  const isOverdue =
    task?.dueDate &&
    isPast(parseLocalDate(task.dueDate)) &&
    task.status !== "complete";
  const isFollowing = task?.followerIds?.includes(currentUser?.id);

  const timerStartMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/tasks/${taskId}/timer/start`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task-timer-sessions", taskId] });
      toast({ title: "Timer started" });
    },
  });

  const timerStopMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/tasks/${taskId}/timer/stop`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task-timer-sessions", taskId] });
      toast({ title: "Timer stopped" });
    },
  });

  const notesMutation = useMutation({
    mutationFn: (notes: string) =>
      apiClient.patch(`/tasks/${taskId}`, { notes }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () =>
      toast({ title: "Failed to save notes", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.patch(`/tasks/${taskId}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setEditing(false);
      toast({ title: "Task updated" });
    },
    onError: () =>
      toast({ title: "Failed to update task", variant: "destructive" }),
  });

  const timerEditMutation = useMutation({
    mutationFn: (elapsedSeconds: number) =>
      apiClient
        .patch(`/tasks/${taskId}/timer/edit`, { elapsedSeconds })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      setEditingTimer(false);
      toast({ title: "Timer updated" });
    },
  });

  const followMutation = useMutation({
    mutationFn: () =>
      isFollowing
        ? apiClient.delete(`/tasks/${taskId}/followers`)
        : apiClient.post(`/tasks/${taskId}/followers`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      toast({ title: isFollowing ? "Unfollowed task" : "Following task" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/tasks/${taskId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      history.back();
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: number) =>
      apiClient.delete(`/tasks/${taskId}/attachments/${attachmentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-attachments", taskId] });
      toast({ title: "Attachment deleted" });
    },
    onError: () =>
      toast({ title: "Failed to delete attachment", variant: "destructive" }),
  });

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so same file can be re-uploaded

    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "File too large",
        description: "Maximum file size is 50 MB.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const urlRes = await apiClient.post("/storage/uploads/request-url", {
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
        taskId,
      });
      const { uploadURL, objectPath } = urlRes.data;

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!putRes.ok) throw new Error(`Storage PUT failed: ${putRes.status}`);

      await apiClient.post(`/tasks/${taskId}/attachments`, {
        fileName: file.name,
        objectPath,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      });

      qc.invalidateQueries({ queryKey: ["task-attachments", taskId] });
      toast({ title: "File uploaded", description: file.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Upload failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  function startEdit() {
    if (!task) return;
    // Prefer the multi-assignee field when present (primary first, then
    // secondaries), but fall back to the legacy single-assignee field for
    // tasks created before the multi-assignee column was introduced.
    const ids: number[] = Array.isArray(task.assigneeIds) && task.assigneeIds.length > 0
      ? [...task.assigneeIds]
      : task.assigneeId != null ? [task.assigneeId] : [];
    setEditForm({
      title: task.title,
      description: task.description ?? "",
      status: task.status,
      priority: task.priority,
      assigneeIds: ids,
      departmentId: task.departmentId ? String(task.departmentId) : "none",
      expectedHours: task.expectedHours ? String(task.expectedHours) : "",
      dueDate: task.dueDate ?? "",
      startDate: task.startDate ?? "",
    });
    setEditing(true);
  }

  function saveEdit() {
    if (!editForm) return;
    updateMutation.mutate({
      title: editForm.title,
      description: editForm.description || undefined,
      status: editForm.status,
      priority: editForm.priority,
      // Send the ordered list; the server treats index 0 as the primary
      // assignee and writes the rest to the join table.
      assigneeIds: editForm.assigneeIds,
      departmentId:
        editForm.departmentId !== "none" ? Number(editForm.departmentId) : null,
      expectedHours: editForm.expectedHours
        ? Number(editForm.expectedHours)
        : undefined,
      dueDate: editForm.dueDate || undefined,
      startDate: editForm.startDate || undefined,
    });
  }

  function saveTimerEdit() {
    const totalSeconds =
      (Number(timerHours) || 0) * 3600 + (Number(timerMins) || 0) * 60;
    timerEditMutation.mutate(totalSeconds);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Task not found</p>
        <Link href="/tasks">
          <Button variant="outline" className="mt-3">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Tasks
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Back */}
      <Link href="/tasks">
        <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-4 h-4" />
          Tasks
        </button>
      </Link>

      {/* Thin project context strip: company • project name • project code.
          Rendered above the task header so the user always knows which
          project a task belongs to without needing to scroll or open another
          page. We intentionally keep this single-line and unobtrusive — no
          card chrome — so the existing detail layout is unchanged. */}
      {project && (
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground mb-4">
          <Building2 className="w-3.5 h-3.5" />
          <Link href={`/projects/${project.id}`}>
            <span className="hover:text-foreground hover:underline cursor-pointer">
              <span className="font-medium">{project.company}</span>
              <span className="mx-1.5 opacity-60">•</span>
              <span>{project.name}</span>
            </span>
          </Link>
          {project.projectId && (
            <>
              <span className="opacity-60">•</span>
              <code className="px-1 py-0.5 rounded bg-muted text-[11px] font-mono">
                {project.projectId}
              </code>
            </>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card>
              <CardContent className="p-6">
                {editing && editForm ? (
                  <div className="space-y-3">
                    <Input
                      value={editForm.title}
                      onChange={(e) =>
                        setEditForm((p) => p && { ...p, title: e.target.value })
                      }
                      className="text-lg font-bold"
                    />
                    <Textarea
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm(
                          (p) => p && { ...p, description: e.target.value },
                        )
                      }
                      rows={4}
                      placeholder="Description..."
                    />
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <Label>Status</Label>
                        <Select
                          value={editForm.status}
                          onValueChange={(v) =>
                            setEditForm((p) => p && { ...p, status: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="backlog">Backlog</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="in_review">In Review</SelectItem>
                            <SelectItem value="on_hold">On Hold</SelectItem>
                            <SelectItem value="blocked">Blocked</SelectItem>
                            <SelectItem value="complete">Completed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Priority</Label>
                        <Select
                          value={editForm.priority}
                          onValueChange={(v) =>
                            setEditForm((p) => p && { ...p, priority: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Assignees</Label>
                        {/* Multi-assignee chip list: each chip removes the
                            user; the picker below adds another. The FIRST
                            chip is the primary assignee (kept on
                            tasks.assignee_id by the server). */}
                        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[1.75rem]">
                          {editForm.assigneeIds.length === 0 && (
                            <span className="text-xs text-muted-foreground">
                              Unassigned
                            </span>
                          )}
                          {editForm.assigneeIds.map((uid, idx) => {
                            const u = (users as UserProfileMini[]).find(
                              (x) => x.id === uid,
                            );
                            return (
                              <Badge
                                key={uid}
                                variant={idx === 0 ? "default" : "secondary"}
                                className="gap-1"
                              >
                                {idx === 0 && (
                                  <span className="text-[10px] uppercase opacity-70">
                                    Primary
                                  </span>
                                )}
                                {u?.name ?? `User #${uid}`}
                                <button
                                  type="button"
                                  className="ml-0.5 opacity-70 hover:opacity-100"
                                  onClick={() =>
                                    setEditForm(
                                      (p) =>
                                        p && {
                                          ...p,
                                          assigneeIds: p.assigneeIds.filter(
                                            (x) => x !== uid,
                                          ),
                                        },
                                    )
                                  }
                                  aria-label={`Remove ${u?.name ?? "user"}`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </Badge>
                            );
                          })}
                        </div>
                        <Select
                          value=""
                          onValueChange={(v) => {
                            const id = Number(v);
                            if (!Number.isFinite(id)) return;
                            setEditForm(
                              (p) =>
                                p && {
                                  ...p,
                                  assigneeIds: p.assigneeIds.includes(id)
                                    ? p.assigneeIds
                                    : [...p.assigneeIds, id],
                                },
                            );
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Add assignee..." />
                          </SelectTrigger>
                          <SelectContent>
                            {(users as UserProfileMini[])
                              .filter(
                                (u) => !editForm.assigneeIds.includes(u.id),
                              )
                              .map((u) => (
                                <SelectItem key={u.id} value={String(u.id)}>
                                  {u.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Department</Label>
                        <Select
                          value={editForm.departmentId}
                          onValueChange={(v) =>
                            setEditForm((p) => p && { ...p, departmentId: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="No department" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No department</SelectItem>
                            {departments.map((d) => (
                              <SelectItem key={d.id} value={String(d.id)}>
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{
                                      backgroundColor: d.color ?? "#6B7280",
                                    }}
                                  />
                                  {d.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Expected Hours</Label>
                        <Input
                          type="number"
                          value={editForm.expectedHours}
                          onChange={(e) =>
                            setEditForm(
                              (p) =>
                                p && { ...p, expectedHours: e.target.value },
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label>Start Date</Label>
                        <Input
                          type="date"
                          value={editForm.startDate}
                          onChange={(e) =>
                            setEditForm(
                              (p) => p && { ...p, startDate: e.target.value },
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label>Due Date</Label>
                        <Input
                          type="date"
                          value={editForm.dueDate}
                          onChange={(e) =>
                            setEditForm(
                              (p) => p && { ...p, dueDate: e.target.value },
                            )
                          }
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setEditing(false)}
                      >
                        <X className="w-4 h-4 mr-1" /> Cancel
                      </Button>
                      <Button
                        onClick={saveEdit}
                        disabled={updateMutation.isPending}
                      >
                        {updateMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-1" />
                        ) : (
                          <Save className="w-4 h-4 mr-1" />
                        )}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span
                            className={cn(
                              "text-xs px-2 py-0.5 rounded-md font-medium capitalize",
                              STATUS_STYLES[task.status],
                            )}
                          >
                            {STATUS_LABELS[task.status] ?? task.status.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-muted-foreground capitalize">
                            {task.priority} priority
                          </span>
                          {isOverdue && (
                            <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
                              <AlertTriangle className="w-3 h-3" /> Overdue
                            </span>
                          )}
                        </div>
                        <h1 className="text-xl font-bold">{task.title}</h1>
                        {task.description && (
                          <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">
                            {task.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={startEdit}
                          title="Edit task"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => followMutation.mutate()}
                          title={isFollowing ? "Unfollow" : "Follow"}
                        >
                          {isFollowing ? (
                            <Bell className="w-4 h-4 text-primary" />
                          ) : (
                            <BellOff className="w-4 h-4" />
                          )}
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              title="Delete task"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          }
                          title="Delete this task?"
                          description="This will permanently delete the task and all its attachments. This action cannot be undone."
                          onConfirm={() => deleteMutation.mutate()}
                          isPending={deleteMutation.isPending}
                        />
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Timer */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Time Tracking
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-3">
                <div className="flex-1">
                  <div
                    className={cn(
                      "text-3xl font-mono font-bold",
                      task.timerRunning && "text-primary",
                    )}
                  >
                    {formatSeconds(elapsed)}
                  </div>
                  {task.expectedHours && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Expected: {task.expectedHours}h ({task.expectedHours * 60}
                      m)
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {task.status === "complete" ? (
                    // Completed tasks can't run the timer (server-side rule),
                    // but we still render a disabled Start button with a
                    // tooltip so the control is discoverable rather than
                    // silently missing.
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0}>
                          <Button
                            disabled
                            aria-disabled="true"
                            className="bg-green-600 hover:bg-green-700 opacity-50 cursor-not-allowed pointer-events-none"
                          >
                            <Play className="w-4 h-4 mr-2" />
                            Start
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Reopen the task to track time
                      </TooltipContent>
                    </Tooltip>
                  ) : task.timerRunning ? (
                    <Button
                      variant="outline"
                      onClick={() => timerStopMutation.mutate()}
                      disabled={timerStopMutation.isPending}
                      className="border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    >
                      <Square className="w-4 h-4 mr-2" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      onClick={() => timerStartMutation.mutate()}
                      disabled={timerStartMutation.isPending}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Start
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setTimerHours(String(Math.floor(elapsed / 3600)));
                      setTimerMins(String(Math.floor((elapsed % 3600) / 60)));
                      setEditingTimer(true);
                    }}
                    title="Edit time"
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {editingTimer && (
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg mb-3">
                  <Input
                    type="number"
                    value={timerHours}
                    onChange={(e) => setTimerHours(e.target.value)}
                    placeholder="h"
                    className="w-16"
                    min="0"
                  />
                  <span className="text-sm text-muted-foreground">h</span>
                  <Input
                    type="number"
                    value={timerMins}
                    onChange={(e) => setTimerMins(e.target.value)}
                    placeholder="m"
                    className="w-16"
                    min="0"
                    max="59"
                  />
                  <span className="text-sm text-muted-foreground">m</span>
                  <Button
                    size="sm"
                    onClick={saveTimerEdit}
                    disabled={timerEditMutation.isPending}
                  >
                    <Save className="w-3 h-3 mr-1" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingTimer(false)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}

              <TimerBar elapsed={elapsed} expectedHours={task.expectedHours} />

              {timerSessions.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between text-left text-xs font-medium text-muted-foreground mb-2 hover:text-foreground"
                    onClick={() => setTimerLogOpen((open) => !open)}
                  >
                    <span className="flex items-center gap-1.5">
                      {timerLogOpen ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      Clock-in log
                    </span>
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                      {timerSessions.length}
                    </Badge>
                  </button>
                  {timerLogOpen && (
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {timerSessions.map((session) => {
                      const duration =
                        session.durationSeconds ??
                        Math.max(
                          0,
                          Math.floor(
                            (Date.now() - new Date(session.startedAt).getTime()) /
                              1000,
                          ),
                        );
                      return (
                        <div
                          key={session.id}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="truncate">
                                {session.startedBy.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(session.startedAt), "MMM d, h:mm a")}
                              </p>
                            </div>
                          </div>
                          <Badge variant="outline" className="flex-shrink-0">
                            {session.stoppedAt ? formatSeconds(duration) : "Running"}
                          </Badge>
                        </div>
                      );
                    })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <StickyNote className="w-4 h-4" />
                Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={() => {
                  const next = notesDraft.trim();
                  const current = task.notes ?? "";
                  if (next !== current) notesMutation.mutate(next);
                }}
                placeholder="Add task notes, shop updates, customer details, or anything the team needs to know..."
                rows={5}
                className="resize-y"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Notes save automatically when you leave this field.
              </p>
            </CardContent>
          </Card>

          {/* Attachments */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Paperclip className="w-4 h-4" />
                  Attachments
                  {attachments.length + projectAttachments.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {attachments.length + projectAttachments.length}
                    </Badge>
                  )}
                </CardTitle>
                <Label htmlFor="file-upload" className="cursor-pointer">
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
                  id="file-upload"
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Project Assets */}
              {projectAttachments.length > 0 && (
                <AttachmentSection
                  title="Project Assets"
                  count={projectAttachments.length}
                  defaultOpen={false}
                >
                  {[...(projectAttachments as ProjectAttachment[])]
                    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned))
                    .map((a) => {
                      const type = getFileType(a);
                      const fileUrl = getFileUrl(a.objectPath);
                      return (
                        <div
                          key={a.id}
                          className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 transition-colors"
                        >
                          {type === "image" ? (
                            <Image className="w-8 h-8 text-blue-500 flex-shrink-0" />
                          ) : type === "pdf" ? (
                            <FileText className="w-8 h-8 text-red-500 flex-shrink-0" />
                          ) : (
                            <File className="w-8 h-8 text-muted-foreground flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm truncate">
                                {a.fileName}
                              </span>
                              {a.isPinned && (
                                <Badge
                                  variant="outline"
                                  className="text-xs py-0 px-1.5 gap-0.5 flex-shrink-0"
                                >
                                  <Pin className="w-2.5 h-2.5" />
                                  pinned
                                </Badge>
                              )}
                            </div>
                            {a.fileSize && (
                              <div className="text-xs text-muted-foreground">
                                {a.fileSize >= 1024 * 1024
                                  ? `${(a.fileSize / 1024 / 1024).toFixed(1)} MB`
                                  : `${(a.fileSize / 1024).toFixed(1)} KB`}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {(type === "image" || type === "pdf") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setPreviewAttachment(a)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            )}
                            <a href={fileUrl} download={a.fileName}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                            </a>
                          </div>
                        </div>
                      );
                    })}
                </AttachmentSection>
              )}

              {/* This Task */}
              <AttachmentSection
                title="This Task"
                count={attachments.length}
                defaultOpen
              >
                {attachments.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No attachments — use Upload above
                  </p>
                ) : (
                  (attachments as TaskAttachment[]).map((a) => {
                    const type = getFileType(a);
                    const fileUrl = getFileUrl(a.objectPath);
                    return (
                      <div
                        key={a.id}
                        className="flex items-center gap-3 p-2 rounded-lg border hover:bg-muted/50 transition-colors"
                      >
                        {type === "image" ? (
                          <img
                            src={fileUrl}
                            alt={a.fileName}
                            className="w-10 h-10 object-cover rounded flex-shrink-0 bg-muted"
                          />
                        ) : type === "pdf" ? (
                          <FileText className="w-8 h-8 text-red-500 flex-shrink-0" />
                        ) : (
                          <File className="w-8 h-8 text-muted-foreground flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{a.fileName}</div>
                          {a.fileSize && (
                            <div className="text-xs text-muted-foreground">
                              {a.fileSize >= 1024 * 1024
                                ? `${(a.fileSize / 1024 / 1024).toFixed(1)} MB`
                                : `${(a.fileSize / 1024).toFixed(1)} KB`}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {(type === "image" || type === "pdf") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setPreviewAttachment(a)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                          <a href={fileUrl} download={a.fileName}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          </a>
                          <ConfirmDialog
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            }
                            title="Delete attachment?"
                            description="This will permanently remove the file. This action cannot be undone."
                            onConfirm={() =>
                              deleteAttachmentMutation.mutate(a.id)
                            }
                            isPending={deleteAttachmentMutation.isPending}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </AttachmentSection>

            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Details */}
          <Card>
            <CardContent className="p-4 space-y-3">
              {task.assignee && (
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Assignee
                    </div>
                    <div className="text-sm font-medium">
                      {task.assignee.name}
                    </div>
                  </div>
                </div>
              )}
              {task.department && (
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Department
                    </div>
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: task.department.color }}
                      />
                      {task.department.name}
                    </div>
                  </div>
                </div>
              )}
              {task.startDate && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Start Date
                    </div>
                    <div className="text-sm font-medium">
                      {format(parseLocalDate(task.startDate), "MMM d, yyyy")}
                    </div>
                  </div>
                </div>
              )}
              {task.dueDate && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Due Date
                    </div>
                    <div
                      className={cn(
                        "text-sm font-medium",
                        isOverdue && "text-red-500",
                      )}
                    >
                      {format(parseLocalDate(task.dueDate), "MMM d, yyyy")}
                      {isOverdue && (
                        <span className="ml-1 text-xs">(overdue)</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {task.completedAt && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Completed
                    </div>
                    <div className="text-sm font-medium">
                      {formatDistanceToNow(new Date(task.completedAt), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground">Followers</div>
                  <div className="text-sm font-medium">
                    {task.followerIds?.length ?? 0}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick status change */}
          <Card>
            <CardContent className="p-4">
              <Label className="text-xs text-muted-foreground mb-2 block">
                Update Status
              </Label>
              <div className="space-y-1.5">
                {([
                  ["backlog", "Backlog"],
                  ["in_progress", "In Progress"],
                  ["in_review", "In Review"],
                  ["on_hold", "On Hold"],
                  ["blocked", "Blocked"],
                  ["complete", "Completed"],
                ] as [string, string][]).map(([status, label]) => (
                  <button
                    key={status}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      task.status === status
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => {
                      if (task.status === status) return;
                      if (status === "complete") {
                        const qOk = task.qualityResult && task.qualityResult !== "pending";
                        const dOk = task.deliveryStatus && task.deliveryStatus !== "pending";
                        if (!qOk || !dOk) {
                          setSqdcError(true);
                          sqdcCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                          setTimeout(() => setSqdcError(false), 4000);
                          return;
                        }
                      }
                      setSqdcError(false);
                      updateMutation.mutate({ status });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* SQDC Validation Card */}
          <div ref={sqdcCardRef}>
          <Card className={cn(
            "transition-all duration-300",
            sqdcError && "ring-2 ring-destructive border-destructive shadow-lg shadow-destructive/20"
          )}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground block font-semibold tracking-wide uppercase">
                  SQDC Validation
                </Label>
                {sqdcError && (
                  <span className="text-xs font-semibold text-destructive flex items-center gap-1 animate-pulse">
                    <AlertTriangle className="w-3 h-3" />
                    Required to complete
                  </span>
                )}
              </div>

              {/* Safety */}
              <div>
                <Label className="text-xs mb-1 block">Safety</Label>
                <Select
                  value={task.safetyFlag ?? "none"}
                  onValueChange={(v) =>
                    updateMutation.mutate({ safetyFlag: v === "none" ? null : v })
                  }
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No issues</SelectItem>
                    <SelectItem value="near_miss">Near Miss</SelectItem>
                    <SelectItem value="incident">Incident</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Quality */}
              <div>
                <Label className={cn("text-xs mb-1 block", sqdcError && (!task.qualityResult || task.qualityResult === "pending") && "text-destructive font-semibold")}>Quality Result</Label>
                <Select
                  value={task.qualityResult ?? "pending"}
                  onValueChange={(v) => {
                    updateMutation.mutate({ qualityResult: v === "pending" ? null : v });
                    if (v !== "pending") setSqdcError(false);
                  }}
                >
                  <SelectTrigger className={cn("h-8 text-sm", sqdcError && (!task.qualityResult || task.qualityResult === "pending") && "border-destructive ring-1 ring-destructive")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="pass">Pass</SelectItem>
                    <SelectItem value="rework">Rework Required</SelectItem>
                    <SelectItem value="fail">Fail</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Delivery */}
              <div>
                <Label className={cn("text-xs mb-1 block", sqdcError && (!task.deliveryStatus || task.deliveryStatus === "pending") && "text-destructive font-semibold")}>Delivery Status</Label>
                <Select
                  value={task.deliveryStatus ?? "pending"}
                  onValueChange={(v) => {
                    updateMutation.mutate({ deliveryStatus: v === "pending" ? null : v });
                    if (v !== "pending") setSqdcError(false);
                  }}
                >
                  <SelectTrigger className={cn("h-8 text-sm", sqdcError && (!task.deliveryStatus || task.deliveryStatus === "pending") && "border-destructive ring-1 ring-destructive")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="on_time">On Time</SelectItem>
                    <SelectItem value="late">Late</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Cost / Material Notes */}
              <div>
                <Label className="text-xs mb-1 block">Cost / Material Notes</Label>
                <SqdcNotesInput task={task} onSave={(v) => updateMutation.mutate({ costMaterialNotes: v || null })} />
              </div>
            </CardContent>
          </Card>
          </div>
        </div>
      </div>

      {/* Attachment preview dialog */}
      <Dialog
        open={!!previewAttachment}
        onOpenChange={() => setPreviewAttachment(null)}
      >
        <DialogContent className="max-w-4xl w-full p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2 pr-14">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-sm font-medium truncate flex-1">
                {previewAttachment?.fileName}
              </DialogTitle>
              {previewAttachment && (
                <a
                  href={getFileUrl(previewAttachment.objectPath)}
                  download={previewAttachment.fileName}
                  className="flex-shrink-0"
                >
                  <Button variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </Button>
                </a>
              )}
            </div>
          </DialogHeader>
          {previewAttachment && getFileType(previewAttachment) === "image" && (
            <div className="flex items-center justify-center bg-muted/30 max-h-[80vh] overflow-auto p-4">
              <img
                src={getFileUrl(previewAttachment.objectPath)}
                alt={previewAttachment.fileName}
                className="max-w-full max-h-[76vh] object-contain rounded"
              />
            </div>
          )}
          {previewAttachment && getFileType(previewAttachment) === "pdf" && (
            <iframe
              src={getFileUrl(previewAttachment.objectPath)}
              title={previewAttachment.fileName}
              className="w-full border-0"
              style={{ height: "80vh" }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
