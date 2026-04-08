import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import type { UserProfileMini, TaskAttachment } from "@/lib/types";
import {
  ArrowLeft, Play, Square, Clock, Edit2, Trash2, Save, X,
  Paperclip, Bell, BellOff, Loader2, AlertTriangle, CheckCircle2,
  Calendar, User, Building2, Upload, FileText, Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLiveTimer } from "@/hooks/useLiveTimer";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const STATUS_STYLES: Record<string, string> = {
  backlog: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  in_review: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  complete: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function TimerBar({ elapsed, expectedHours }: { elapsed: number; expectedHours: number | null }) {
  if (!expectedHours) return null;
  const pct = Math.min(100, (elapsed / (expectedHours * 3600)) * 100);
  const isOver = pct >= 100;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">Progress vs expected</span>
        <span className={isOver ? "text-orange-500 font-semibold" : "text-muted-foreground"}>
          {pct.toFixed(0)}% of {expectedHours}h
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", isOver ? "bg-orange-500" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
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
    assigneeId: string;
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

  const { data: task, isLoading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => apiClient.get(`/tasks/${taskId}`).then(r => r.data),
    refetchInterval: 10000,
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ["task-attachments", taskId],
    queryFn: () => apiClient.get(`/tasks/${taskId}/attachments`).then(r => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/users").then(r => r.data),
  });

  const elapsed = useLiveTimer(task?.elapsedSeconds ?? 0, task?.timerRunning ?? false, task?.timerStartedAt ?? null);
  const isOverdue = task?.dueDate && isPast(new Date(task.dueDate)) && task.status !== "complete";
  const isFollowing = task?.followerIds?.includes(currentUser?.id);

  const timerStartMutation = useMutation({
    mutationFn: () => apiClient.post(`/tasks/${taskId}/timer/start`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Timer started" });
    },
  });

  const timerStopMutation = useMutation({
    mutationFn: () => apiClient.post(`/tasks/${taskId}/timer/stop`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Timer stopped" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.patch(`/tasks/${taskId}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setEditing(false);
      toast({ title: "Task updated" });
    },
    onError: () => toast({ title: "Failed to update task", variant: "destructive" }),
  });

  const timerEditMutation = useMutation({
    mutationFn: (elapsedSeconds: number) => apiClient.patch(`/tasks/${taskId}/timer/edit`, { elapsedSeconds }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      setEditingTimer(false);
      toast({ title: "Timer updated" });
    },
  });

  const followMutation = useMutation({
    mutationFn: () => isFollowing
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

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const urlRes = await apiClient.post("/storage/uploads/request-url", {
        name: file.name,
        size: file.size,
        contentType: file.type,
      });
      const { uploadURL, objectPath } = urlRes.data;

      await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      await apiClient.post(`/tasks/${taskId}/attachments`, {
        fileName: file.name,
        objectPath,
        fileSize: file.size,
        mimeType: file.type,
      });

      qc.invalidateQueries({ queryKey: ["task-attachments", taskId] });
      toast({ title: "File uploaded" });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function startEdit() {
    if (!task) return;
    setEditForm({
      title: task.title,
      description: task.description ?? "",
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId ? String(task.assigneeId) : "none",
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
      assigneeId: editForm.assigneeId !== "none" ? Number(editForm.assigneeId) : undefined,
      expectedHours: editForm.expectedHours ? Number(editForm.expectedHours) : undefined,
      dueDate: editForm.dueDate || undefined,
      startDate: editForm.startDate || undefined,
    });
  }

  function saveTimerEdit() {
    const totalSeconds = (Number(timerHours) || 0) * 3600 + (Number(timerMins) || 0) * 60;
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
    <div className="p-6 max-w-5xl mx-auto">
      {/* Back */}
      <Link href="/tasks">
        <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" />
          Tasks
        </button>
      </Link>

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
                      onChange={e => setEditForm(p => p && ({ ...p, title: e.target.value }))}
                      className="text-lg font-bold"
                    />
                    <Textarea
                      value={editForm.description}
                      onChange={e => setEditForm(p => p && ({ ...p, description: e.target.value }))}
                      rows={4}
                      placeholder="Description..."
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Status</Label>
                        <Select value={editForm.status} onValueChange={v => setEditForm(p => p && ({ ...p, status: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="backlog">Backlog</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="in_review">In Review</SelectItem>
                            <SelectItem value="blocked">Blocked</SelectItem>
                            <SelectItem value="complete">Complete</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Priority</Label>
                        <Select value={editForm.priority} onValueChange={v => setEditForm(p => p && ({ ...p, priority: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Assignee</Label>
                        <Select value={editForm.assigneeId} onValueChange={v => setEditForm(p => p && ({ ...p, assigneeId: v }))}>
                          <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Unassigned</SelectItem>
                            {(users as UserProfileMini[]).map(u => (
                              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Expected Hours</Label>
                        <Input type="number" value={editForm.expectedHours} onChange={e => setEditForm(p => p && ({ ...p, expectedHours: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Start Date</Label>
                        <Input type="date" value={editForm.startDate} onChange={e => setEditForm(p => p && ({ ...p, startDate: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Due Date</Label>
                        <Input type="date" value={editForm.dueDate} onChange={e => setEditForm(p => p && ({ ...p, dueDate: e.target.value }))} />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setEditing(false)}>
                        <X className="w-4 h-4 mr-1" /> Cancel
                      </Button>
                      <Button onClick={saveEdit} disabled={updateMutation.isPending}>
                        {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={cn("text-xs px-2 py-0.5 rounded-md font-medium capitalize", STATUS_STYLES[task.status])}>
                            {task.status.replace("_", " ")}
                          </span>
                          <span className="text-xs text-muted-foreground capitalize">{task.priority} priority</span>
                          {isOverdue && (
                            <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
                              <AlertTriangle className="w-3 h-3" /> Overdue
                            </span>
                          )}
                        </div>
                        <h1 className="text-xl font-bold">{task.title}</h1>
                        {task.description && (
                          <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">{task.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button variant="ghost" size="icon" onClick={startEdit} title="Edit task">
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => followMutation.mutate()}
                          title={isFollowing ? "Unfollow" : "Follow"}
                        >
                          {isFollowing ? <Bell className="w-4 h-4 text-primary" /> : <BellOff className="w-4 h-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm("Delete this task?")) deleteMutation.mutate();
                          }}
                          title="Delete task"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
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
                  <div className={cn("text-3xl font-mono font-bold", task.timerRunning && "text-primary")}>
                    {formatSeconds(elapsed)}
                  </div>
                  {task.expectedHours && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Expected: {task.expectedHours}h ({task.expectedHours * 60}m)
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {task.status !== "complete" && (
                    task.timerRunning ? (
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
                    )
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
                    onChange={e => setTimerHours(e.target.value)}
                    placeholder="h"
                    className="w-16"
                    min="0"
                  />
                  <span className="text-sm text-muted-foreground">h</span>
                  <Input
                    type="number"
                    value={timerMins}
                    onChange={e => setTimerMins(e.target.value)}
                    placeholder="m"
                    className="w-16"
                    min="0"
                    max="59"
                  />
                  <span className="text-sm text-muted-foreground">m</span>
                  <Button size="sm" onClick={saveTimerEdit} disabled={timerEditMutation.isPending}>
                    <Save className="w-3 h-3 mr-1" />
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingTimer(false)}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}

              <TimerBar elapsed={elapsed} expectedHours={task.expectedHours} />
            </CardContent>
          </Card>

          {/* Attachments */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Paperclip className="w-4 h-4" />
                  Attachments ({attachments.length})
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
            <CardContent>
              {attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No attachments</p>
              ) : (
                <div className="space-y-2">
                  {(attachments as TaskAttachment[]).map(a => (
                    <a
                      key={a.id}
                      href={`/api/storage/objects${a.objectPath.replace(/^\/objects/, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors"
                    >
                      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{a.fileName}</div>
                        {a.fileSize && (
                          <div className="text-xs text-muted-foreground">
                            {(a.fileSize / 1024).toFixed(1)} KB
                          </div>
                        )}
                      </div>
                    </a>
                  ))}
                </div>
              )}
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
                    <div className="text-xs text-muted-foreground">Assignee</div>
                    <div className="text-sm font-medium">{task.assignee.name}</div>
                  </div>
                </div>
              )}
              {task.department && (
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Department</div>
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: task.department.color }} />
                      {task.department.name}
                    </div>
                  </div>
                </div>
              )}
              {task.startDate && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Start Date</div>
                    <div className="text-sm font-medium">{format(new Date(task.startDate), "MMM d, yyyy")}</div>
                  </div>
                </div>
              )}
              {task.dueDate && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Due Date</div>
                    <div className={cn("text-sm font-medium", isOverdue && "text-red-500")}>
                      {format(new Date(task.dueDate), "MMM d, yyyy")}
                      {isOverdue && <span className="ml-1 text-xs">(overdue)</span>}
                    </div>
                  </div>
                </div>
              )}
              {task.completedAt && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Completed</div>
                    <div className="text-sm font-medium">{formatDistanceToNow(new Date(task.completedAt), { addSuffix: true })}</div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div>
                  <div className="text-xs text-muted-foreground">Followers</div>
                  <div className="text-sm font-medium">{task.followerIds?.length ?? 0}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick status change */}
          <Card>
            <CardContent className="p-4">
              <Label className="text-xs text-muted-foreground mb-2 block">Update Status</Label>
              <div className="space-y-1.5">
                {["backlog", "in_progress", "in_review", "blocked", "complete"].map(status => (
                  <button
                    key={status}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      task.status === status
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => {
                      if (task.status !== status) {
                        updateMutation.mutate({ status });
                      }
                    }}
                  >
                    <span className="capitalize">{status.replace("_", " ")}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
