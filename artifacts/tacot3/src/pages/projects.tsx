import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import type { Project, Department } from "@/lib/types";
import {
  Plus, FolderKanban, FileText, Search, Loader2, ChevronRight,
  Building2, Calendar, Eraser, Info, DollarSign,
  ChevronUp, ChevronDown, Edit2, Check, Minus, Zap, X, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatQuoteNum } from "@/lib/utils";
import ProjectInfoDialog from "@/components/projects/ProjectInfoDialog";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  on_hold: "outline",
  cancelled: "destructive",
};

const PRIORITY_ORDER = ["low", "medium", "high", "urgent"] as const;
type Priority = (typeof PRIORITY_ORDER)[number];
const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low", medium: "Medium", high: "High", urgent: "Urgent",
};
const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#3b82f6", medium: "#eab308", high: "#f97316", urgent: "#ef4444",
};
const PRIORITY_ICONS: Record<Priority, React.ElementType> = {
  low: ChevronDown, medium: Minus, high: ChevronUp, urgent: Zap,
};

const EMPTY_FORM = {
  name: "", company: "", projectId: "", description: "", fullDescription: "",
  startDate: "", status: "active", address: "", contactName: "",
  contactPhone: "", contactEmail: "", totalPrice: "",
  deliveryDate: "", scopeOfWork: "",
};

// ── Task Staging Dialog ─────────────────────────────────────────────────────
interface StagingTask {
  id: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  departmentId: number | null;
  parentTaskId: number | null;
  startDate: string | null;
}

function useStagingTasks(projectId: number) {
  return useQuery<StagingTask[]>({
    queryKey: ["staging-tasks", projectId],
    queryFn: () =>
      apiClient.get(`/tasks?projectId=${projectId}&status=new_tasks`).then(r => r.data),
    staleTime: 0,
  });
}

function StagingSubtaskRow({
  task,
  onTitleSave,
  onDelete,
}: {
  task: StagingTask;
  onTitleSave: (id: number, title: string) => void;
  onDelete: (id: number) => void;
}) {
  const [localTitle, setLocalTitle] = useState(task.title);
  useEffect(() => { setLocalTitle(task.title); }, [task.title]);

  return (
    <div className="flex items-center gap-2 pl-6 py-1 group">
      <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      <Input
        value={localTitle}
        onChange={e => setLocalTitle(e.target.value)}
        onBlur={() => { if (localTitle.trim() && localTitle !== task.title) onTitleSave(task.id, localTitle.trim()); }}
        className="h-6 text-xs border-transparent focus:border-input bg-transparent hover:border-input px-1"
      />
      <button
        onClick={() => onDelete(task.id)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5 flex-shrink-0"
        title="Delete subtask"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

function StagingGroup({
  parent,
  subtasks,
  departments,
  onPatch,
  onDelete,
  onAddSubtask,
}: {
  parent: StagingTask;
  subtasks: StagingTask[];
  departments: Department[];
  onPatch: (id: number, patch: Partial<StagingTask>) => void;
  onDelete: (ids: number[]) => void;
  onAddSubtask: (parentId: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [localTitle, setLocalTitle] = useState(parent.title);
  useEffect(() => { setLocalTitle(parent.title); }, [parent.title]);

  const priority = parent.priority as Priority;
  const PIcon = PRIORITY_ICONS[priority] ?? Minus;

  function handleTitleBlur() {
    const t = localTitle.trim();
    if (t && t !== parent.title) onPatch(parent.id, { title: t });
  }

  function handleDeleteParent() {
    onDelete([parent.id, ...subtasks.map(s => s.id)]);
  }

  return (
    <Card className="mb-2">
      <CardContent className="p-3 pb-2">
        {/* Parent row */}
        <div className="flex items-center gap-2">
          <button onClick={() => setExpanded(v => !v)} className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <Input
            value={localTitle}
            onChange={e => setLocalTitle(e.target.value)}
            onBlur={handleTitleBlur}
            className="h-7 text-sm font-medium border-transparent focus:border-input bg-transparent hover:border-input flex-1 px-1 min-w-0"
          />
          {/* Priority pill */}
          <div className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 flex-shrink-0">
            <button onClick={() => onPatch(parent.id, { priority: PRIORITY_ORDER[Math.max(0, PRIORITY_ORDER.indexOf(priority) - 1)] })} className="text-muted-foreground hover:text-foreground">
              <ChevronDown className="w-3 h-3" />
            </button>
            <PIcon className="w-3 h-3" style={{ color: PRIORITY_COLORS[priority] }} />
            <button onClick={() => onPatch(parent.id, { priority: PRIORITY_ORDER[Math.min(PRIORITY_ORDER.length - 1, PRIORITY_ORDER.indexOf(priority) + 1)] })} className="text-muted-foreground hover:text-foreground">
              <ChevronUp className="w-3 h-3" />
            </button>
          </div>
          {/* Dept select */}
          <Select
            value={parent.departmentId?.toString() ?? "none"}
            onValueChange={v => onPatch(parent.id, { departmentId: v === "none" ? null : Number(v) })}
          >
            <SelectTrigger className="h-7 text-xs w-[130px] flex-shrink-0">
              <SelectValue placeholder="Dept" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No dept</SelectItem>
              {departments.map(d => (
                <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Delete parent button */}
          <button
            onClick={handleDeleteParent}
            className="text-muted-foreground hover:text-destructive transition-colors p-0.5 flex-shrink-0"
            title="Delete task group"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Subtasks list */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="subtasks"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="mt-1.5 border-t pt-1.5">
                {subtasks.map(s => (
                  <StagingSubtaskRow
                    key={s.id}
                    task={s}
                    onTitleSave={(id, title) => onPatch(id, { title })}
                    onDelete={id => onDelete([id])}
                  />
                ))}
                <button
                  onClick={() => onAddSubtask(parent.id)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground pl-6 py-1 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add subtask
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function TaskStagingDialog({
  projectId,
  onClose,
}: {
  projectId: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: rawTasks = [], isLoading, refetch } = useStagingTasks(projectId);

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["departments", "global"],
    queryFn: () => apiClient.get("/departments?global=true").then(r => r.data as Department[]),
  });

  const [localMap, setLocalMap] = useState<Map<number, StagingTask>>(new Map());
  const initialised = useRef(false);

  useEffect(() => {
    if (!initialised.current && rawTasks.length > 0) {
      initialised.current = true;
      setLocalMap(new Map(rawTasks.map(t => [t.id, t])));
    }
  }, [rawTasks]);

  const allTasks = useMemo(() => Array.from(localMap.values()), [localMap]);
  const parents = useMemo(() => allTasks.filter(t => !t.parentTaskId), [allTasks]);
  const childrenMap = useMemo(() => {
    const m = new Map<number, StagingTask[]>();
    for (const t of allTasks) {
      if (t.parentTaskId != null) {
        const arr = m.get(t.parentTaskId) ?? [];
        arr.push(t);
        m.set(t.parentTaskId, arr);
      }
    }
    return m;
  }, [allTasks]);

  const [discarding, setDiscarding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<StagingTask> }) =>
      apiClient.patch(`/tasks/${id}`, patch).then(r => r.data),
    onError: () => toast({ title: "Failed to save change", variant: "destructive" }),
  });

  function handlePatch(id: number, patch: Partial<StagingTask>) {
    setLocalMap(prev => {
      const m = new Map(prev);
      const existing = m.get(id);
      if (existing) m.set(id, { ...existing, ...patch });
      return m;
    });
    patchMutation.mutate({ id, patch });
  }

  async function handleDelete(ids: number[]) {
    setLocalMap(prev => {
      const m = new Map(prev);
      ids.forEach(id => m.delete(id));
      return m;
    });
    await Promise.allSettled(ids.map(id => apiClient.delete(`/tasks/${id}`)));
  }

  async function handleAddSubtask(parentId: number) {
    const parent = localMap.get(parentId);
    if (!parent) return;
    try {
      const r = await apiClient.post("/tasks", {
        title: "New subtask",
        projectId,
        parentTaskId: parentId,
        status: "new_tasks",
        priority: "medium",
        departmentId: parent.departmentId,
      });
      const newTask: StagingTask = {
        id: r.data.id,
        title: r.data.title,
        description: r.data.description ?? null,
        priority: r.data.priority,
        status: r.data.status,
        departmentId: r.data.departmentId ?? null,
        parentTaskId: r.data.parentTaskId ?? parentId,
        startDate: r.data.startDate ?? null,
      };
      setLocalMap(prev => {
        const m = new Map(prev);
        m.set(newTask.id, newTask);
        return m;
      });
    } catch {
      toast({ title: "Failed to add subtask", variant: "destructive" });
    }
  }

  async function handleDiscardAll() {
    setDiscarding(true);
    const ids = allTasks.length > 0 ? allTasks.map(t => t.id) : rawTasks.map(t => t.id);
    await Promise.allSettled(ids.map(id => apiClient.delete(`/tasks/${id}`)));
    setDiscarding(false);
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["kanban"] });
    toast({ title: "Tasks removed", description: "No template tasks were kept." });
    onClose();
  }

  function handleDone() {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["kanban-tasks"] });
    const totalSubtasks = allTasks.filter(t => t.parentTaskId != null).length;
    toast({
      title: "Tasks ready",
      description: `${parents.length} task groups (${totalSubtasks} subtasks) added to New Tasks`,
    });
    onClose();
  }

  const parentCount = parents.length;
  const subtaskCount = allTasks.filter(t => t.parentTaskId != null).length;

  return (
    <>
      <Dialog open onOpenChange={open => { if (!open) handleDone(); }}>
        <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-5 pb-3 flex-shrink-0 border-b">
            <DialogTitle className="flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-amber-500" />
              Review Project Tasks
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isLoading
                ? "Loading tasks…"
                : `${parentCount} task group${parentCount !== 1 ? "s" : ""} · ${subtaskCount} subtask${subtaskCount !== 1 ? "s" : ""} — edit titles, remove groups, then continue.`}
            </p>
          </DialogHeader>

          <ScrollArea className="flex-1 overflow-auto px-6 py-4">
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && parents.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No tasks found. Click Done to continue.</p>
            )}
            {!isLoading && parents.map(parent => (
              <StagingGroup
                key={parent.id}
                parent={parent}
                subtasks={childrenMap.get(parent.id) ?? []}
                departments={departments}
                onPatch={handlePatch}
                onDelete={handleDelete}
                onAddSubtask={handleAddSubtask}
              />
            ))}
          </ScrollArea>

          <div className="px-6 py-4 border-t flex-shrink-0 flex items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
              onClick={() => setConfirmDiscard(true)}
              disabled={discarding}
            >
              {discarding ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
              Discard All
            </Button>
            <Button onClick={handleDone} disabled={discarding}>
              <Check className="w-4 h-4 mr-1.5" />
              Done Staging
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard all tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {allTasks.length} template tasks for this project. The project itself will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDiscardAll}
              disabled={discarding}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {discarding ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              Yes, Discard All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── New Project Dialog ──────────────────────────────────────────────────────
function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (projectId: number, hasTasks: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);

  function clearForm() {
    setForm(EMPTY_FORM);
    setFile(null);
  }

  function handleClose(v: boolean) {
    if (!v) clearForm();
    onOpenChange(v);
  }

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiClient.post("/projects", data).then(r => r.data),
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ["projects"] });

      // Auto-pin the PDF that was used to create this project
      if (file && file.type === "application/pdf") {
        try {
          const urlRes = await apiClient.post("/storage/uploads/request-url", {
            name: file.name,
            size: file.size,
            contentType: "application/pdf",
          });
          const { uploadURL, objectPath } = urlRes.data;
          const putRes = await fetch(uploadURL, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": "application/pdf" },
          });
          if (putRes.ok) {
            await apiClient.post(`/projects/${data.id}/attachments`, {
              fileName: file.name,
              objectPath,
              fileSize: file.size,
              mimeType: "application/pdf",
              isPinned: true,
            });
          }
        } catch {
          // Non-critical — project still created, just skip attachment
        }
      }

      toast({ title: "Project created" });
      clearForm();
      onOpenChange(false);
      onCreated?.(data.id, true);
    },
    onError: () => toast({ title: "Failed to create project", variant: "destructive" }),
  });

  async function handlePdfParse() {
    if (!file) return;
    setParsing(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await apiClient.post("/projects/parse-pdf", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const data = r.data;
      setForm(prev => ({
        ...prev,
        ...data,
        projectId: data.projectId ? formatQuoteNum(data.projectId) : prev.projectId,
      }));
      toast({ title: "PDF parsed", description: "Project details filled in from document." });
    } catch {
      toast({ title: "Failed to parse PDF", variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5" />
            New Project
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="space-y-4 pt-2 pb-2">
            {/* PDF import */}
            <div className="flex items-center gap-2 p-3 rounded-lg border-2 border-dashed border-border bg-muted/30">
              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <input
                  type="file"
                  accept=".pdf"
                  className="w-full text-sm file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-primary file:text-primary-foreground cursor-pointer"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button size="sm" variant="outline" onClick={handlePdfParse} disabled={!file || parsing}>
                {parsing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Parse PDF"}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Project Name *</Label>
                <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Custom Welding Fixture" />
              </div>
              <div>
                <Label>Company</Label>
                <Input value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} placeholder="Acme Manufacturing Co." />
              </div>
              <div>
                <Label>Quote / Project ID</Label>
                <Input value={form.projectId} onChange={e => setForm(p => ({ ...p, projectId: e.target.value }))} placeholder="QT-2024-0042" />
              </div>
              <div className="col-span-2">
                <Label>Address</Label>
                <Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="742 Evergreen Terrace, Springfield, CA 90210" />
              </div>
              <div>
                <Label>Contact Name</Label>
                <Input value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))} placeholder="Jane Smith" />
              </div>
              <div>
                <Label>Contact Phone</Label>
                <Input value={form.contactPhone} onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))} placeholder="555-867-5309" />
              </div>
              <div>
                <Label>Contact Email</Label>
                <Input value={form.contactEmail} onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))} placeholder="jsmith@acmemfg.com" />
              </div>
              <div>
                <Label>Total Price</Label>
                <Input value={form.totalPrice} onChange={e => setForm(p => ({ ...p, totalPrice: e.target.value }))} placeholder="$85,000.00" />
              </div>
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div>
                <Label>Delivery Date</Label>
                <Input type="date" value={form.deliveryDate} onChange={e => setForm(p => ({ ...p, deliveryDate: e.target.value }))} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Brief Description</Label>
                <Textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="High-level description shown on project card..."
                  rows={2}
                />
              </div>
              <div className="col-span-2">
                <Label>Scope of Work</Label>
                <Textarea
                  value={form.scopeOfWork}
                  onChange={e => setForm(p => ({ ...p, scopeOfWork: e.target.value }))}
                  placeholder="Detailed scope parsed from the quote (line items, bullet points)..."
                  rows={4}
                />
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between pt-3 border-t">
          <Button variant="ghost" size="sm" onClick={clearForm} className="text-muted-foreground">
            <Eraser className="w-4 h-4 mr-1.5" />
            Clear
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate({ ...form })}
              disabled={!form.name || mutation.isPending}
            >
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Project
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Projects Page ───────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [infoProject, setInfoProject] = useState<Project | null>(null);
  const [stagingProjectId, setStagingProjectId] = useState<number | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });

  const filtered = (projects as Project[]).filter(p =>
    [p.name, p.company, p.projectId].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  function handleProjectCreated(projectId: number, hasTasks: boolean) {
    if (hasTasks) setStagingProjectId(projectId);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground text-sm mt-1">{projects.length} total</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Project
        </Button>
      </div>

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search projects..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderKanban className="w-12 h-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No projects found</p>
          <Button className="mt-4" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create first project
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((project, i: number) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Card className="h-full hover:shadow-md transition-all hover:border-primary/50 group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <FolderKanban className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={e => { e.preventDefault(); e.stopPropagation(); setInfoProject(project); }}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="View project info"
                      >
                        <Info className="w-4 h-4" />
                      </button>
                      <Badge variant={STATUS_VARIANTS[project.status] ?? "secondary"} className="capitalize">
                        {project.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </div>

                  <Link href={`/projects/${project.id}`} className="block">
                    <h3 className="font-semibold line-clamp-2 mb-1 group-hover:text-primary transition-colors">
                      {project.name}
                    </h3>
                    <div className="space-y-1 mt-2">
                      {project.company && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Building2 className="w-3 h-3" />
                          <span className="truncate">{project.company}</span>
                        </div>
                      )}
                      {project.projectId && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <FileText className="w-3 h-3" />
                          <span>{formatQuoteNum(project.projectId)}</span>
                        </div>
                      )}
                      {project.startDate && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          <span>{format(new Date(project.startDate), "MMM d, yyyy")}</span>
                        </div>
                      )}
                      {project.totalPrice && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <DollarSign className="w-3 h-3" />
                          <span className="font-medium text-green-600 dark:text-green-400">{project.totalPrice}</span>
                        </div>
                      )}
                    </div>
                    {project.description && (
                      <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{project.description}</p>
                    )}
                    <div className="flex items-center justify-end mt-3">
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <NewProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleProjectCreated}
      />

      {infoProject && (
        <ProjectInfoDialog
          project={infoProject}
          onClose={() => setInfoProject(null)}
        />
      )}

      {stagingProjectId !== null && (
        <TaskStagingDialog
          projectId={stagingProjectId}
          onClose={() => setStagingProjectId(null)}
        />
      )}
    </div>
  );
}
