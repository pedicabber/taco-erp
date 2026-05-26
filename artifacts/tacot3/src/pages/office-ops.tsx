import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type {
  OfficeOpsTask,
  OfficeOpsTaskRecurrence,
  CreateOfficeOpsTaskBody,
  UpdateOfficeOpsTaskBody,
  UserProfileMini,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, RefreshCw, CheckCircle2, Circle, Pencil } from "lucide-react";

type Filter = "open" | "completed" | "overdue";
type Scope = "mine" | "all";

const RECURRENCE_LABEL: Record<OfficeOpsTaskRecurrence, string> = {
  none: "One-off",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDueDate(date: string | null): string {
  if (!date) return "—";
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isOverdue(t: OfficeOpsTask): boolean {
  return !!t.dueDate && t.status === "open" && t.dueDate < todayIso();
}

function isDueToday(t: OfficeOpsTask): boolean {
  return t.dueDate === todayIso() && t.status === "open";
}

export default function OfficeOpsPage() {
  const { data: currentUser } = useCurrentUser();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<Filter>("open");
  const [scope, setScope] = useState<Scope>("mine");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OfficeOpsTask | null>(null);

  const { data: users } = useQuery<UserProfileMini[]>({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/users").then((r) => r.data),
  });

  const tasksQuery = useQuery<OfficeOpsTask[]>({
    queryKey: ["office-ops-tasks", filter, scope],
    queryFn: () =>
      apiClient
        .get("/office-ops/tasks", { params: { filter, scope } })
        .then((r) => r.data),
  });

  const tasks = tasksQuery.data ?? [];
  const myId = currentUser?.id ?? null;

  const sections = useMemo(() => {
    if (filter !== "open") {
      return [{ key: "all", title: filter === "completed" ? "Completed" : "Overdue", items: tasks }];
    }
    const today = todayIso();
    const mine: OfficeOpsTask[] = [];
    const dueToday: OfficeOpsTask[] = [];
    const overdue: OfficeOpsTask[] = [];
    const upcoming: OfficeOpsTask[] = [];

    for (const t of tasks) {
      if (myId !== null && t.assigneeId === myId) {
        mine.push(t);
        continue;
      }
      if (isOverdue(t)) overdue.push(t);
      else if (isDueToday(t)) dueToday.push(t);
      else upcoming.push(t);
    }

    return [
      { key: "mine", title: "Assigned to Me", items: mine },
      { key: "overdue", title: "Overdue", items: overdue },
      { key: "today", title: `Due Today (${today})`, items: dueToday },
      { key: "upcoming", title: "Upcoming / Unscheduled", items: upcoming },
    ].filter((s) => s.items.length > 0);
  }, [tasks, filter, myId]);

  const createMut = useMutation({
    mutationFn: (body: CreateOfficeOpsTaskBody) =>
      apiClient.post("/office-ops/tasks", body).then((r) => r.data as OfficeOpsTask),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["office-ops-tasks"] });
      setCreateOpen(false);
      toast({ title: "Task created" });
    },
    onError: (err: Error) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateOfficeOpsTaskBody }) =>
      apiClient.patch(`/office-ops/tasks/${id}`, body).then((r) => r.data as OfficeOpsTask),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["office-ops-tasks"] });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/office-ops/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["office-ops-tasks"] });
      toast({ title: "Task deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const isAdmin = currentUser?.role === "admin";

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl" data-testid="page-office-ops">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold">Office Ops</h1>
          <p className="text-sm text-muted-foreground">Lightweight task workspace for the office.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="scope-toggle"
              checked={scope === "all"}
              onCheckedChange={(v) => setScope(v ? "all" : "mine")}
              data-testid="switch-scope"
            />
            <Label htmlFor="scope-toggle" className="text-sm cursor-pointer">
              Show all
            </Label>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-task">
                <Plus className="w-4 h-4 mr-1" /> New task
              </Button>
            </DialogTrigger>
            <TaskDialog
              key={createOpen ? "create-open" : "create-closed"}
              mode="create"
              users={users ?? []}
              busy={createMut.isPending}
              onSubmit={(body) => createMut.mutate(body)}
            />
          </Dialog>
        </div>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)} className="mb-4">
        <TabsList>
          <TabsTrigger value="open" data-testid="tab-open">Open</TabsTrigger>
          <TabsTrigger value="overdue" data-testid="tab-overdue">Overdue</TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-completed">Completed</TabsTrigger>
        </TabsList>
      </Tabs>

      {tasksQuery.isLoading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
      ) : sections.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          No tasks in this view. {filter === "open" && "Create one to get started."}
        </Card>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {section.title}
                <span className="ml-2 text-xs font-normal">({section.items.length})</span>
              </h2>
              <div className="space-y-2">
                {section.items.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    users={users ?? []}
                    currentUserId={myId}
                    isAdmin={isAdmin}
                    onToggle={(next) =>
                      updateMut.mutate({ id: t.id, body: { status: next } })
                    }
                    onEdit={() => setEditing(t)}
                    onDelete={() => {
                      if (confirm(`Delete "${t.title}"?`)) deleteMut.mutate(t.id);
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <TaskDialog
            key={`edit-${editing.id}`}
            mode="edit"
            users={users ?? []}
            initial={editing}
            busy={updateMut.isPending}
            onSubmit={(body) => {
              updateMut.mutate(
                { id: editing.id, body },
                { onSuccess: () => setEditing(null) },
              );
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function TaskRow({
  task,
  users,
  currentUserId,
  isAdmin,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: OfficeOpsTask;
  users: UserProfileMini[];
  currentUserId: number | null;
  isAdmin: boolean;
  onToggle: (status: "open" | "completed") => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const assignee = users.find((u) => u.id === task.assigneeId);
  // Any user who can see this page has Office Ops access and is allowed to
  // edit/complete (product decision #2). Suppress unused-var noise from the
  // currentUserId / isAdmin props that are still threaded for delete gating.
  void currentUserId;
  const canMutate = true;
  const completed = task.status === "completed";
  const overdue = isOverdue(task);
  return (
    <Card
      className="p-3 flex items-start gap-3 hover-elevate"
      data-testid={`task-row-${task.id}`}
    >
      <button
        type="button"
        className="mt-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
        title={canMutate ? (completed ? "Reopen" : "Mark complete") : "Not allowed"}
        disabled={!canMutate}
        onClick={() => onToggle(completed ? "open" : "completed")}
        data-testid={`button-toggle-${task.id}`}
      >
        {completed ? (
          <CheckCircle2 className="w-5 h-5 text-primary" />
        ) : (
          <Circle className="w-5 h-5" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`font-medium ${completed ? "line-through text-muted-foreground" : ""}`}
          >
            {task.title}
          </span>
          {task.recurrence !== "none" && (
            <Badge variant="outline" className="gap-1">
              <RefreshCw className="w-3 h-3" />
              {RECURRENCE_LABEL[task.recurrence]}
            </Badge>
          )}
          {overdue && <Badge variant="destructive">Overdue</Badge>}
        </div>
        {task.notes && (
          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">
            {task.notes}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
          <span>Due: {formatDueDate(task.dueDate)}</span>
          <span>Assignee: {assignee?.name ?? (task.assigneeId ? `#${task.assigneeId}` : "Unassigned")}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {canMutate && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            data-testid={`button-edit-${task.id}`}
            title="Edit"
          >
            <Pencil className="w-4 h-4" />
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            data-testid={`button-delete-${task.id}`}
            title="Delete"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        )}
      </div>
    </Card>
  );
}

function TaskDialog({
  mode,
  initial,
  users,
  busy,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial?: OfficeOpsTask;
  users: UserProfileMini[];
  busy: boolean;
  onSubmit: (body: CreateOfficeOpsTaskBody & UpdateOfficeOpsTaskBody) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [assigneeId, setAssigneeId] = useState<string>(
    initial?.assigneeId != null ? String(initial.assigneeId) : "unassigned",
  );
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [recurrence, setRecurrence] = useState<OfficeOpsTaskRecurrence>(
    initial?.recurrence ?? "none",
  );

  function handleSubmit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSubmit({
      title: trimmed,
      notes: notes.trim() ? notes : null,
      assigneeId: assigneeId === "unassigned" ? null : Number(assigneeId),
      dueDate: dueDate || null,
      recurrence,
    });
  }

  return (
    <DialogContent data-testid={`dialog-${mode}-task`}>
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "New Office Ops task" : "Edit task"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="oo-title">Title</Label>
          <Input
            id="oo-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            data-testid="input-title"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="oo-notes">Notes</Label>
          <Textarea
            id="oo-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional details"
            rows={4}
            data-testid="input-notes"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="oo-due">Due date</Label>
            <Input
              id="oo-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              data-testid="input-due-date"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Recurrence</Label>
            <Select
              value={recurrence}
              onValueChange={(v) => setRecurrence(v as OfficeOpsTaskRecurrence)}
            >
              <SelectTrigger data-testid="select-recurrence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">One-off</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Assignee</Label>
          <Select value={assigneeId} onValueChange={setAssigneeId}>
            <SelectTrigger data-testid="select-assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={handleSubmit} disabled={busy || !title.trim()} data-testid="button-submit-task">
          {mode === "create" ? "Create task" : "Save changes"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
