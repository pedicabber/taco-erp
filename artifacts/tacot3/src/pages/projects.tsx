import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import type { Project, Department, ParsedTaskItem } from "@/lib/types";
import {
  Plus, FolderKanban, FileText, Search, Loader2, ChevronRight,
  Building2, Calendar, Eraser, Info, DollarSign,
  ChevronUp, ChevronDown, Edit2, Check, Minus, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
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
};

// ── Task Staging Dialog ─────────────────────────────────────────────────────
interface StagingTask {
  id: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  departmentId: number | null;
  startDate: string | null;
}

function TaskStagingCard({
  task,
  departments,
  onChange,
}: {
  task: StagingTask;
  departments: Department[];
  onChange: (id: number, patch: Partial<StagingTask>) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const priority = task.priority as Priority;
  const PIcon = PRIORITY_ICONS[priority] ?? Minus;
  const pColor = PRIORITY_COLORS[priority] ?? "#eab308";

  function bumpPriority(dir: 1 | -1) {
    const idx = PRIORITY_ORDER.indexOf(priority);
    const next = PRIORITY_ORDER[Math.max(0, Math.min(PRIORITY_ORDER.length - 1, idx + dir))];
    onChange(task.id, { priority: next });
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        {/* Title row */}
        <div className="flex items-start gap-2">
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex-1 text-left min-w-0"
          >
            <p className={cn("text-sm font-medium line-clamp-2", expanded && "line-clamp-none")}>
              {task.title}
            </p>
            {task.description && !expanded && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{task.description}</p>
            )}
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
            title={expanded ? "Collapse" : "Expand to edit"}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Expanded edit mode */}
        {expanded && (
          <div className="mt-3 space-y-2 pt-3 border-t">
            <div>
              <Label className="text-xs text-muted-foreground">Title</Label>
              <Input
                value={task.title}
                onChange={e => onChange(task.id, { title: e.target.value })}
                className="h-7 text-sm mt-0.5"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Description</Label>
              <Textarea
                value={task.description ?? ""}
                onChange={e => onChange(task.id, { description: e.target.value })}
                rows={3}
                className="text-sm mt-0.5"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Start Date</Label>
              <Input
                type="date"
                value={task.startDate ?? ""}
                onChange={e => onChange(task.id, { startDate: e.target.value })}
                className="h-7 text-sm mt-0.5"
              />
            </div>
          </div>
        )}

        {/* Controls row */}
        <div className="flex items-center gap-2 mt-3">
          {/* Priority control */}
          <div className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5">
            <button onClick={() => bumpPriority(-1)} className="text-muted-foreground hover:text-foreground p-0.5">
              <ChevronDown className="w-3 h-3" />
            </button>
            <span className="text-[10px] font-medium w-12 text-center" style={{ color: pColor }}>
              {PRIORITY_LABELS[priority]}
            </span>
            <button onClick={() => bumpPriority(1)} className="text-muted-foreground hover:text-foreground p-0.5">
              <ChevronUp className="w-3 h-3" />
            </button>
          </div>

          {/* Department */}
          <Select
            value={task.departmentId?.toString() ?? "none"}
            onValueChange={v => onChange(task.id, { departmentId: v === "none" ? null : parseInt(v, 10) })}
          >
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No department</SelectItem>
              {departments.map(d => (
                <SelectItem key={d.id} value={d.id.toString()}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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

  const { data: rawTasks = [], isLoading } = useQuery<StagingTask[]>({
    queryKey: ["staging-tasks", projectId],
    queryFn: () =>
      apiClient
        .get(`/tasks?projectId=${projectId}&status=new_tasks`)
        .then(r => r.data),
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["departments", projectId],
    queryFn: () =>
      apiClient
        .get(`/departments?projectId=${projectId}`)
        .then(r => (r.data as Department[]).filter(d => d.projectId === projectId)),
  });

  const [localTasks, setLocalTasks] = useState<StagingTask[]>([]);
  const [initialised, setInitialised] = useState(false);
  if (!initialised && rawTasks.length > 0) {
    setLocalTasks(rawTasks);
    setInitialised(true);
  }

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<StagingTask> }) =>
      apiClient.patch(`/tasks/${id}`, patch).then(r => r.data),
  });

  function handleChange(id: number, patch: Partial<StagingTask>) {
    setLocalTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
    patchMutation.mutate({ id, patch });
  }

  function handleDone() {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["kanban-tasks"] });
    toast({ title: "Tasks staged", description: `${localTasks.length} tasks ready in New Tasks` });
    onClose();
  }

  const tasks = localTasks.length > 0 ? localTasks : rawTasks;

  return (
    <Dialog open onOpenChange={open => { if (!open) handleDone(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="pr-10">
            <DialogTitle className="flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-amber-500" />
              Stage Imported Tasks
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} imported — set departments and priorities, then continue.
            </p>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="flex-1 -mx-1 px-1">
            <div className="space-y-2 pb-2">
              {tasks.map(task => (
                <TaskStagingCard
                  key={task.id}
                  task={task}
                  departments={departments}
                  onChange={handleChange}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="flex items-center justify-between pt-3 border-t">
          <p className="text-xs text-muted-foreground">
            You can always edit tasks later from the board.
          </p>
          <Button onClick={handleDone} className="gap-1.5">
            <Check className="w-4 h-4" />
            Done Staging
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  const [parsedTasks, setParsedTasks] = useState<ParsedTaskItem[]>([]);

  function clearForm() {
    setForm(EMPTY_FORM);
    setFile(null);
    setParsedTasks([]);
  }

  function handleClose(v: boolean) {
    if (!v) clearForm();
    onOpenChange(v);
  }

  const mutation = useMutation({
    mutationFn: (data: typeof form & { parsedTasks: ParsedTaskItem[] }) =>
      apiClient.post("/projects", data).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project created" });
      clearForm();
      onOpenChange(false);
      onCreated?.(data.id, parsedTasks.length > 0);
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
      setForm(prev => ({ ...prev, ...data }));
      setParsedTasks(data.parsedTasks ?? []);
      toast({ title: "PDF parsed", description: `${data.parsedTasks?.length ?? 0} tasks detected` });
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

            {/* Parsed tasks preview */}
            {parsedTasks.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                  <FolderKanban className="w-3.5 h-3.5" />
                  {parsedTasks.length} tasks will be created in "New Tasks"
                </p>
                <ul className="space-y-1">
                  {parsedTasks.slice(0, 6).map((t, i) => (
                    <li key={i} className="text-xs text-amber-900 dark:text-amber-300 flex items-start gap-1.5">
                      <span className="mt-0.5 text-amber-500">•</span>
                      <span className="line-clamp-1">{t.title}</span>
                    </li>
                  ))}
                  {parsedTasks.length > 6 && (
                    <li className="text-xs text-amber-600 dark:text-amber-500 pl-3">
                      + {parsedTasks.length - 6} more...
                    </li>
                  )}
                </ul>
              </div>
            )}

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
              onClick={() => mutation.mutate({ ...form, parsedTasks })}
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
                          <span>{project.projectId}</span>
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
