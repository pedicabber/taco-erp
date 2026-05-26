import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import { formatQuoteNum } from "@/lib/utils";
import type { Task, Project } from "@/lib/types";
import {
  ArrowLeft, Loader2, Building2, FileText,
  Calendar, CheckSquare, FolderKanban, Info, Users, ChevronDown, ChevronRight, Package,
  CalendarClock, AlertTriangle,
} from "lucide-react";
import ProjectInfoDialog from "@/components/projects/ProjectInfoDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useState } from "react";
import { format } from "date-fns";
import TaskCard from "@/components/tasks/TaskCard";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import ProjectAttachmentsPanel from "@/components/projects/ProjectAttachmentsPanel";
import {
  computePhaseWindows,
  computeDriftSeverity,
  delayReasonLabel,
  DELAY_REASONS,
  DRIFT_SEVERITY_CLASS,
  DRIFT_SEVERITY_BG,
  type DelayReasonValue,
} from "@/lib/schedule";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  on_hold: "outline",
  cancelled: "destructive",
};

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [infoOpen, setInfoOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(true);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const qc = useQueryClient();
  const { data: currentUser } = useCurrentUser();

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiClient.patch(`/projects/${projectId}`, { status }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}`).then(r => r.data),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", { projectId }],
    queryFn: () => apiClient.get(`/tasks?projectId=${projectId}&topLevelOnly=true`).then(r => r.data),
  });

  const { data: summary } = useQuery({
    queryKey: ["project-summary", projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/summary`).then(r => r.data),
  });

  const { data: allocatedInventory = [] } = useQuery<Array<{
    allocationId: number;
    quantity: number;
    notes: string | null;
    createdAt: string;
    item: { id: number; sku: string; name: string; category: string; unit: string; unitCost: string | null };
  }>>({
    queryKey: ["project-inventory", projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/inventory`).then(r => r.data),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Project not found</p>
        <Link href="/projects">
          <Button variant="outline" className="mt-3">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Projects
          </Button>
        </Link>
      </div>
    );
  }

  const completedTasks = (tasks as Task[]).filter(t => t.status === "complete").length;

  // Derive "Involved Departments" from task.department (resolved: task's own OR assignee's dept).
  // Preserve task order as returned by the API; preserve department order by first-appearance.
  const involvedDeptMap = new Map<number, { id: number; name: string; color: string | null; tasks: Task[] }>();
  const unassignedTasks: Task[] = [];
  for (const task of tasks as Task[]) {
    const d = task.department;
    if (!d) {
      unassignedTasks.push(task);
      continue;
    }
    const existing = involvedDeptMap.get(d.id);
    if (existing) {
      existing.tasks.push(task);
    } else {
      involvedDeptMap.set(d.id, { id: d.id, name: d.name, color: d.color, tasks: [task] });
    }
  }
  const involvedDepartments = [...involvedDeptMap.values()];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto overflow-x-hidden">
      {/* Header */}
      <div className="mb-6">
        <Link href="/projects">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
            <ArrowLeft className="w-4 h-4" />
            Projects
          </button>
        </Link>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <FolderKanban className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-xl sm:text-2xl font-bold leading-tight break-words min-w-0">{project.name}</h1>
              <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                <button
                  onClick={() => setInfoOpen(true)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  title="View project info"
                >
                  <Info className="w-4 h-4" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1 focus:outline-none">
                      <Badge
                        variant={STATUS_VARIANTS[project.status] ?? "secondary"}
                        className="capitalize cursor-pointer hover:opacity-80 transition-opacity"
                      >
                        {project.status.replace("_", " ")}
                        <ChevronDown className="w-3 h-3 ml-1 inline" />
                      </Badge>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {[
                      { value: "active", label: "Active" },
                      { value: "on_hold", label: "On Hold" },
                      { value: "completed", label: "Completed" },
                      { value: "cancelled", label: "Cancelled" },
                    ].map(opt => (
                      <DropdownMenuItem
                        key={opt.value}
                        onClick={() => statusMutation.mutate(opt.value)}
                        className="flex items-center gap-2"
                      >
                        <Badge variant={STATUS_VARIANTS[opt.value] ?? "secondary"} className="capitalize text-xs">
                          {opt.label}
                        </Badge>
                        {project.status === opt.value && <span className="ml-auto text-xs text-muted-foreground">current</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {project.company && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                  {project.company}
                </span>
              )}
              {project.projectId && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                  {formatQuoteNum(project.projectId)}
                </span>
              )}
              {project.startDate && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                  Started {format(new Date(project.startDate), "MMM d, yyyy")}
                </span>
              )}
            </div>
            {project.description && (
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{project.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckSquare className="w-5 h-5 text-primary" />
            <div>
              <div className="text-lg font-bold">{tasks.length}</div>
              <div className="text-xs text-muted-foreground">Total Tasks</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckSquare className="w-5 h-5 text-green-500" />
            <div>
              <div className="text-lg font-bold">{completedTasks}</div>
              <div className="text-xs text-muted-foreground">Completed</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Users className="w-5 h-5 text-orange-500" />
            <div>
              <div className="text-lg font-bold">{involvedDepartments.length}</div>
              <div className="text-xs text-muted-foreground">Departments</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Calendar className="w-5 h-5 text-red-500" />
            <div>
              <div className="text-lg font-bold">{summary?.overdueTasks ?? 0}</div>
              <div className="text-xs text-muted-foreground">Overdue</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Schedule (baseline vs active + phase windows + drift) */}
      <ScheduleSection
        project={project}
        canReschedule={!!currentUser && (currentUser.role === "admin" || currentUser.id === project.createdById)}
        onOpenReschedule={() => setRescheduleOpen(true)}
      />

      <RescheduleDialog
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        project={project}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["project", projectId] });
          qc.invalidateQueries({ queryKey: ["projects"] });
          qc.invalidateQueries({ queryKey: ["tasks", { projectId }] });
          qc.invalidateQueries({ queryKey: ["project-summary", projectId] });
        }}
      />

      {/* Involved Departments (collapsible groups of tasks) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Involved Departments</h2>
          {tasks.length > 0 && (
            <Link href={`/tasks?projectId=${projectId}`}>
              <Button size="sm" variant="outline">View all tasks</Button>
            </Link>
          )}
        </div>
        {tasks.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-sm text-muted-foreground">No tasks yet — departments appear here once tasks are assigned.</p>
              <Link href={`/tasks?projectId=${projectId}`}>
                <Button size="sm" className="mt-3">
                  Create Task
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : involvedDepartments.length === 0 && unassignedTasks.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-sm text-muted-foreground">No departments assigned to tasks in this project.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {involvedDepartments.map(dept => (
              <DepartmentTaskGroup
                key={dept.id}
                name={dept.name}
                color={dept.color}
                tasks={dept.tasks}
              />
            ))}
            {unassignedTasks.length > 0 && (
              <DepartmentTaskGroup
                key="unassigned"
                name="Unassigned"
                color={null}
                tasks={unassignedTasks}
              />
            )}
          </div>
        )}
      </div>

      {/* Allocated Inventory */}
      <div className="mt-6">
        <button
          className="flex items-center gap-2 w-full text-left mb-3 group"
          onClick={() => setInventoryOpen(v => !v)}
        >
          {inventoryOpen
            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          <Package className="w-4 h-4 text-primary" />
          <h2 className="font-semibold">Allocated Inventory</h2>
          {allocatedInventory.length > 0 && (
            <Badge variant="secondary" className="text-xs">{allocatedInventory.length}</Badge>
          )}
        </button>

        {inventoryOpen && (
          <Card>
            {allocatedInventory.length === 0 ? (
              <CardContent className="p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No inventory allocated to this project yet.{" "}
                  <Link href="/inventory">
                    <span className="text-primary hover:underline cursor-pointer">Go to Inventory</span>
                  </Link>{" "}
                  to allocate items.
                </p>
              </CardContent>
            ) : (
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">SKU</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Item</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs hidden md:table-cell">Category</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">Qty</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs hidden lg:table-cell">Unit Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {allocatedInventory.map(alloc => (
                      <tr key={alloc.allocationId} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{alloc.item.sku}</td>
                        <td className="px-4 py-2.5 font-medium">{alloc.item.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{alloc.item.category}</td>
                        <td className="px-4 py-2.5 font-semibold">
                          {alloc.quantity}
                          <span className="text-xs text-muted-foreground font-normal ml-1">{alloc.item.unit}</span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground hidden lg:table-cell">
                          {alloc.item.unitCost ? `$${parseFloat(alloc.item.unitCost).toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            )}
          </Card>
        )}
      </div>

      {/* Attachment dump */}
      <div className="mt-6">
        <ProjectAttachmentsPanel projectId={projectId} />
      </div>

      {infoOpen && project && (
        <ProjectInfoDialog
          project={project as Project}
          onClose={() => setInfoOpen(false)}
        />
      )}
    </div>
  );
}

function DepartmentTaskGroup({
  name,
  color,
  tasks,
}: {
  name: string;
  color: string | null;
  tasks: Task[];
}) {
  const [open, setOpen] = useState(false);
  const count = tasks.length;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full p-3 flex items-center gap-3 text-left hover:bg-muted/40 transition-colors"
            data-testid={`department-toggle-${name}`}
          >
            {open
              ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: color ?? "#6B7280" }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{name}</div>
              <div className="text-xs text-muted-foreground">{count} task{count !== 1 ? "s" : ""}</div>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/60">
            {tasks.map(task => (
              <TaskCard key={task.id} task={task} compact />
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ─── Schedule section ────────────────────────────────────────────────────────
function ScheduleSection({
  project,
  canReschedule,
  onOpenReschedule,
}: {
  project: Project & {
    baselineStartDate?: string | null;
    baselineDeliveryDate?: string | null;
    activeStartDate?: string | null;
    activeDeliveryDate?: string | null;
    scheduleDriftDays?: number | null;
    delayReason?: string | null;
    delayNotes?: string | null;
    schedule?: {
      baselineStartDate: string | null;
      baselineDeliveryDate: string | null;
      activeStartDate: string | null;
      activeDeliveryDate: string | null;
      scheduleDriftDays: number;
      driftSeverity: "green" | "yellow" | "red";
      delayReason: string | null;
      delayNotes: string | null;
      engineeringPhase: { startDate: string | null; endDate: string | null; weeks: number | null };
      manufacturingPhase: { startDate: string | null; endDate: string | null; weeks: number | null };
    };
  };
  canReschedule: boolean;
  onOpenReschedule: () => void;
}) {
  // Prefer the server-rendered schedule object; fall back to recomputing
  // locally from the flat project fields so the section still works against
  // any legacy /projects/:id response that hasn't been refetched yet.
  const s = project.schedule;
  const baselineStart = s?.baselineStartDate ?? project.baselineStartDate ?? null;
  const baselineDelivery = s?.baselineDeliveryDate ?? project.baselineDeliveryDate ?? null;
  const activeStart = s?.activeStartDate ?? project.activeStartDate ?? project.startDate ?? null;
  const activeDelivery = s?.activeDeliveryDate ?? project.activeDeliveryDate ?? project.deliveryDate ?? null;
  const drift = s?.scheduleDriftDays ?? project.scheduleDriftDays ?? 0;
  const severity = s?.driftSeverity ?? computeDriftSeverity(drift);
  const delayReason = s?.delayReason ?? project.delayReason ?? null;
  const delayNotes = s?.delayNotes ?? project.delayNotes ?? null;
  const windows = s
    ? { engineering: s.engineeringPhase, manufacturing: s.manufacturingPhase }
    : computePhaseWindows(activeStart, activeDelivery);

  const fmt = (d: string | null) => (d ? format(new Date(d + "T00:00:00"), "MMM d, yyyy") : "—");
  const fmtRange = (a: string | null, b: string | null, weeks: number | null) =>
    a && b ? `${format(new Date(a + "T00:00:00"), "MMM d")} → ${format(new Date(b + "T00:00:00"), "MMM d, yyyy")}${weeks ? `  ·  ${weeks} wk` : ""}` : "—";

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-primary" />
          Schedule
        </h2>
        {canReschedule && (
          <Button size="sm" variant="outline" onClick={onOpenReschedule}>
            Reschedule
          </Button>
        )}
      </div>
      <Card className={DRIFT_SEVERITY_BG[severity] + " border"}>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Baseline Start</div>
            <div className="font-medium">{fmt(baselineStart)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Baseline Delivery</div>
            <div className="font-medium">{fmt(baselineDelivery)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Active Start</div>
            <div className="font-medium">{fmt(activeStart)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Active Delivery</div>
            <div className="font-medium">{fmt(activeDelivery)}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground">Engineering Window (25%)</div>
            <div className="font-medium">{fmtRange(windows.engineering.startDate, windows.engineering.endDate, windows.engineering.weeks)}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground">Manufacturing Window (30%)</div>
            <div className="font-medium">{fmtRange(windows.manufacturing.startDate, windows.manufacturing.endDate, windows.manufacturing.weeks)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Drift Days</div>
            <div className={"font-bold text-base " + DRIFT_SEVERITY_CLASS[severity]}>
              {drift > 0 ? `+${drift}` : drift}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Drift Severity</div>
            <div className={"font-medium capitalize " + DRIFT_SEVERITY_CLASS[severity]}>{severity}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground">Delay Reason</div>
            <div className="font-medium">{delayReasonLabel(delayReason)}</div>
            {delayNotes && (
              <div className="text-xs text-muted-foreground mt-0.5 italic">{delayNotes}</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Reschedule dialog ───────────────────────────────────────────────────────
function RescheduleDialog({
  open,
  onOpenChange,
  project,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project: Project & {
    activeStartDate?: string | null;
    activeDeliveryDate?: string | null;
    schedule?: {
      activeStartDate: string | null;
      activeDeliveryDate: string | null;
    };
  };
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const initialStart = project.schedule?.activeStartDate ?? project.activeStartDate ?? project.startDate ?? "";
  const initialDelivery = project.schedule?.activeDeliveryDate ?? project.activeDeliveryDate ?? project.deliveryDate ?? "";

  const [activeStartDate, setActiveStartDate] = useState(initialStart ?? "");
  const [activeDeliveryDate, setActiveDeliveryDate] = useState(initialDelivery ?? "");
  const [delayReason, setDelayReason] = useState<DelayReasonValue | "">("");
  const [delayNotes, setDelayNotes] = useState("");

  // Reset form whenever the dialog opens against a (possibly new) project.
  const resetForm = () => {
    setActiveStartDate(initialStart ?? "");
    setActiveDeliveryDate(initialDelivery ?? "");
    setDelayReason("");
    setDelayNotes("");
  };

  const mutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { delayReason };
      if (activeStartDate !== (initialStart ?? "")) body.activeStartDate = activeStartDate || null;
      if (activeDeliveryDate !== (initialDelivery ?? "")) body.activeDeliveryDate = activeDeliveryDate || null;
      if (delayNotes.trim()) body.delayNotes = delayNotes.trim();
      return apiClient.post(`/projects/${project.id}/reschedule`, body).then(r => r.data);
    },
    onSuccess: () => {
      toast({ title: "Project rescheduled" });
      onSuccess();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Reschedule failed";
      toast({ title: msg, variant: "destructive" });
    },
  });

  // Live preview of new ENG/MFG windows for the active dates entered.
  const preview = computePhaseWindows(activeStartDate || null, activeDeliveryDate || null);

  const noDateChange =
    activeStartDate === (initialStart ?? "") &&
    activeDeliveryDate === (initialDelivery ?? "");
  const disabled = mutation.isPending || !delayReason || noDateChange;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) resetForm();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary" />
            Reschedule Project
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Updates the ACTIVE schedule only. The baseline (original commitment)
            is preserved so drift remains visible.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Active Start</Label>
              <Input
                type="date"
                value={activeStartDate}
                onChange={(e) => setActiveStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Active Delivery</Label>
              <Input
                type="date"
                value={activeDeliveryDate}
                onChange={(e) => setActiveDeliveryDate(e.target.value)}
              />
            </div>
          </div>

          {(preview.engineering.startDate || preview.manufacturing.startDate) && (
            <div className="rounded-md border bg-muted/40 p-2 text-xs space-y-1">
              <div>
                <span className="text-muted-foreground">Engineering:</span>{" "}
                {preview.engineering.startDate && preview.engineering.endDate
                  ? `${preview.engineering.startDate} → ${preview.engineering.endDate} (${preview.engineering.weeks} wk)`
                  : "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Manufacturing:</span>{" "}
                {preview.manufacturing.startDate && preview.manufacturing.endDate
                  ? `${preview.manufacturing.startDate} → ${preview.manufacturing.endDate} (${preview.manufacturing.weeks} wk)`
                  : "—"}
              </div>
            </div>
          )}

          <div>
            <Label>Delay Reason *</Label>
            <Select value={delayReason} onValueChange={(v) => setDelayReason(v as DelayReasonValue)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {DELAY_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              rows={3}
              value={delayNotes}
              onChange={(e) => setDelayNotes(e.target.value)}
              placeholder="What happened? Anything the team should know."
            />
          </div>

          {noDateChange && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              Change at least one active date to record a reschedule.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={disabled}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save Reschedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
