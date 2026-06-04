import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import {
  Plus, Search, Loader2, CheckSquare, ChevronDown, ChevronRight,
  User, Users, Building2, Globe, Info,
} from "lucide-react";
import type { Project, Department, UserProfileMini, Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import TaskCard from "@/components/tasks/TaskCard";
import { motion } from "framer-motion";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

function NewTaskDialog({
  open,
  onOpenChange,
  defaultProjectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultProjectId?: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments", "global"],
    queryFn: () => apiClient.get("/departments?global=true").then(r => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/users").then(r => r.data),
  });

  const NONE = "none";
  const [form, setForm] = useState({
    title: "",
    description: "",
    projectId: defaultProjectId ? String(defaultProjectId) : "",
    departmentId: NONE,
    assigneeId: NONE,
    status: "backlog",
    priority: "medium",
    expectedHours: "",
    dueDate: "",
    startDate: "",
  });

  const filteredDepts = departments as Department[];

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.post("/tasks", data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      toast({ title: "Task created" });
      onOpenChange(false);
      setForm({
        title: "",
        description: "",
        projectId: defaultProjectId ? String(defaultProjectId) : "",
        departmentId: NONE,
        assigneeId: NONE,
        status: "backlog",
        priority: "medium",
        expectedHours: "",
        dueDate: "",
        startDate: "",
      });
    },
    onError: () => toast({ title: "Failed to create task", variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.title || !form.projectId) return;
    mutation.mutate({
      title: form.title,
      description: form.description || undefined,
      projectId: Number(form.projectId),
      departmentId: form.departmentId !== NONE ? Number(form.departmentId) : undefined,
      assigneeId: form.assigneeId !== NONE ? Number(form.assigneeId) : undefined,
      status: form.status,
      priority: form.priority,
      expectedHours: form.expectedHours ? Number(form.expectedHours) : undefined,
      dueDate: form.dueDate || undefined,
      startDate: form.startDate || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5" />
            New Task
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4 pt-2">
          <div>
            <Label>Title *</Label>
            <Input
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              placeholder="Task description..."
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="col-span-full">
              <Label>Project *</Label>
              <Select value={form.projectId} onValueChange={v => setForm(p => ({ ...p, projectId: v, departmentId: NONE }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {(projects as Project[]).map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.company} - {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department</Label>
              <Select value={form.departmentId} onValueChange={v => setForm(p => ({ ...p, departmentId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {filteredDepts.map((d: Department) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Assignee</Label>
              <Select value={form.assigneeId} onValueChange={v => setForm(p => ({ ...p, assigneeId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(users as UserProfileMini[]).map(u => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="backlog">Backlog</SelectItem>
                  <SelectItem value="new_tasks">New Tasks</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="in_review">In Review</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
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
              <Label>Expected Hours</Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={form.expectedHours}
                onChange={e => setForm(p => ({ ...p, expectedHours: e.target.value }))}
                placeholder="e.g. 8"
              />
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} />
            </div>
            <div className="col-span-full">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Task details..."
                rows={3}
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!form.title || !form.projectId || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Scope = "mine" | "department" | "all";

interface DeptBucket {
  id: number | null;
  name: string;
  color: string | null;
  tasks: Task[];
}

interface ProjectBucket {
  id: number | null;
  name: string;
  projectIdLabel: string | null;
  company: string | null;
  depts: DeptBucket[];
  taskCount: number;
  overdueCount: number;
  completeCount: number;
}

const OTHER_PROJECT_KEY = -1;
const OTHER_DEPT_KEY = -1;

function isOverdue(t: Task): boolean {
  if (!t.dueDate || t.status === "complete") return false;
  const [y, m, d] = t.dueDate.split("-").map(Number);
  if (!y || !m || !d) return false;
  return new Date(y, m - 1, d).getTime() < new Date().setHours(0, 0, 0, 0);
}

export default function TasksPage() {
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const defaultProjectId = params.get("projectId") ? Number(params.get("projectId")) : undefined;

  const { data: currentUser } = useCurrentUser();
  const myId: number | undefined = currentUser?.id;
  const myDeptIds: number[] = useMemo(() => {
    const ids = new Set<number>();
    if (currentUser?.departmentId) ids.add(currentUser.departmentId);
    for (const id of (currentUser?.departmentIds ?? []) as number[]) ids.add(id);
    return [...ids];
  }, [currentUser?.departmentId, currentUser?.departmentIds]);

  const [scope, setScope] = useState<Scope>("mine");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterProject, setFilterProject] = useState(defaultProjectId ? String(defaultProjectId) : "all");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [collapsedProjects, setCollapsedProjects] = useState<Set<number>>(new Set());
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [didInitMobile, setDidInitMobile] = useState(false);

  // Employee filter is administrative refinement only: visible when an admin
  // has explicitly opened the scope to All Accessible. Otherwise the scope
  // toggle already governs "whose tasks am I looking at."
  const showEmployeeFilter = currentUser?.role === "admin" && scope === "all";
  useEffect(() => {
    if (!showEmployeeFilter && filterEmployee !== "all") setFilterEmployee("all");
  }, [showEmployeeFilter, filterEmployee]);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/users").then(r => r.data),
  });

  // Server-side filters: only project + status. Visibility scope, assignee
  // membership, and subtask inclusion are applied client-side so the same
  // single fetch can power all three scope modes without thrashing the cache.
  // OA hidden-container filtering still runs server-side via the API guard.
  const queryParams = new URLSearchParams();
  if (filterProject !== "all") queryParams.set("projectId", filterProject);
  if (filterStatus !== "all") queryParams.set("status", filterStatus);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", filterProject, filterStatus],
    queryFn: () => apiClient.get(`/tasks?${queryParams.toString()}`).then(r => r.data),
  });

  const projectMap = useMemo(() => {
    const m = new Map<number, Project>();
    for (const p of projects as Project[]) m.set(p.id, p);
    return m;
  }, [projects]);

  // ── Visibility pipeline ───────────────────────────────────────────────────
  // 1. Apply scope (mine / department / all)
  // 2. Subtask rule: only include subtasks that are assigned to the current user
  // 3. Apply secondary filters (employee, priority, search)
  const visibleTasks = useMemo(() => {
    const all = tasks as Task[];
    const meAssigned = (t: Task) =>
      myId !== undefined && (t.assigneeIds ?? []).includes(myId);
    const inMyDept = (t: Task) =>
      t.department?.id !== undefined && t.department?.id !== null &&
      myDeptIds.includes(t.department.id);

    return all.filter(t => {
      // Subtasks: only visible if assigned to me (regardless of scope).
      if (t.parentTaskId !== null && t.parentTaskId !== undefined) {
        if (!meAssigned(t)) return false;
      }

      // Scope gate
      if (scope === "mine") {
        if (!meAssigned(t)) return false;
      } else if (scope === "department") {
        if (!meAssigned(t) && !inMyDept(t)) return false;
      }
      // scope === "all": no additional scope gate

      // Employee filter (independent of scope toggle)
      if (filterEmployee !== "all") {
        const empId = Number(filterEmployee);
        if (!(t.assigneeIds ?? []).includes(empId)) return false;
      }
      if (filterPriority !== "all" && t.priority !== filterPriority) return false;
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [tasks, scope, myId, myDeptIds, filterEmployee, filterPriority, search]);

  // ── Project → Department → Tasks bucketing ────────────────────────────────
  const projectBuckets: ProjectBucket[] = useMemo(() => {
    const byProject = new Map<number, ProjectBucket>();

    for (const t of visibleTasks) {
      const pid = t.projectId ?? OTHER_PROJECT_KEY;
      let pb = byProject.get(pid);
      if (!pb) {
        const proj = projectMap.get(pid);
        pb = {
          id: proj ? proj.id : null,
          name: proj?.name ?? "Other",
          projectIdLabel: proj?.projectId ?? null,
          company: proj?.company ?? null,
          depts: [],
          taskCount: 0,
          overdueCount: 0,
          completeCount: 0,
        };
        byProject.set(pid, pb);
      }
      const dId = t.department?.id ?? OTHER_DEPT_KEY;
      let db = pb.depts.find(d => (d.id ?? OTHER_DEPT_KEY) === dId);
      if (!db) {
        db = {
          id: t.department?.id ?? null,
          name: t.department?.name ?? "Other",
          color: t.department?.color ?? null,
          tasks: [],
        };
        pb.depts.push(db);
      }
      db.tasks.push(t);
      pb.taskCount += 1;
      if (isOverdue(t)) pb.overdueCount += 1;
      if (t.status === "complete") pb.completeCount += 1;
    }

    const projectList = [...byProject.values()];
    projectList.sort((a, b) => {
      if (a.name === "Other") return 1;
      if (b.name === "Other") return -1;
      return a.name.localeCompare(b.name);
    });
    for (const pb of projectList) {
      pb.depts.sort((a, b) => {
        if (a.name === "Other") return 1;
        if (b.name === "Other") return -1;
        return a.name.localeCompare(b.name);
      });
    }
    return projectList;
  }, [visibleTasks, projectMap]);

  // Mobile default: collapse all projects on first paint of the bucket list.
  // We do this once per "list shape" rather than on every render so the user's
  // manual expand/collapse choices stick.
  useEffect(() => {
    if (didInitMobile) return;
    if (projectBuckets.length === 0) return;
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    if (isMobile) {
      setCollapsedProjects(new Set(projectBuckets.map(p => p.id ?? OTHER_PROJECT_KEY)));
    }
    setDidInitMobile(true);
  }, [projectBuckets, didInitMobile]);

  function toggleProject(id: number) {
    setCollapsedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleDept(key: string) {
    setCollapsedDepts(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const scopeOptions: { value: Scope; label: string; Icon: typeof User; help: string }[] = [
    { value: "mine",       label: "Assigned to Me",   Icon: User,     help: "Tasks directly assigned to you (including subtasks)" },
    { value: "department", label: "My Departments",   Icon: Users,    help: "Tasks visible through your department membership" },
    { value: "all",        label: "All Accessible",   Icon: Globe,    help: "Every task you have permission to see" },
  ];

  const activeScope = scopeOptions.find(o => o.value === scope)!;

  const hiddenByScope = (() => {
    if (scope === "all") return 0;
    const total = (tasks as Task[]).filter(t => {
      // Subtasks not assigned to me are ignored everywhere, including the count.
      if (t.parentTaskId !== null && t.parentTaskId !== undefined) {
        return myId !== undefined && (t.assigneeIds ?? []).includes(myId);
      }
      return true;
    }).length;
    // Use a scope-only visible count (ignoring search/priority/employee secondary filters)
    // so the banner answers "how many more would appear if I widened scope?" not
    // "how many more if I cleared every filter."
    const scopeVisible = (tasks as Task[]).filter(t => {
      if (t.parentTaskId !== null && t.parentTaskId !== undefined) {
        return myId !== undefined && (t.assigneeIds ?? []).includes(myId);
      }
      const meAssigned = myId !== undefined && (t.assigneeIds ?? []).includes(myId);
      const inMyDept = t.department?.id !== undefined && t.department?.id !== null &&
        myDeptIds.includes(t.department.id);
      if (scope === "mine") return meAssigned;
      if (scope === "department") return meAssigned || inMyDept;
      return true;
    }).length;
    return Math.max(0, total - scopeVisible);
  })();

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {visibleTasks.length} task{visibleTasks.length !== 1 ? "s" : ""} shown
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Task
        </Button>
      </div>

      {/* Visibility scope toggle */}
      <div className="mb-3">
        <div className="inline-flex rounded-lg border bg-card p-1 gap-0.5" role="tablist" aria-label="Task visibility scope">
          {scopeOptions.map(opt => {
            const Icon = opt.Icon;
            const active = scope === opt.value;
            return (
              <button
                key={opt.value}
                role="tab"
                aria-selected={active}
                onClick={() => setScope(opt.value)}
                title={opt.help}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active scope hint banner */}
      {scope !== "all" && hiddenByScope > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900/50 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">
          <div className="flex items-start gap-2 flex-1 min-w-[200px]">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              Showing <span className="font-semibold">{activeScope.label}</span>.{" "}
              {hiddenByScope} additional accessible task{hiddenByScope !== 1 ? "s" : ""} hidden.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setScope(scope === "mine" ? "department" : "all")}
            className="h-7 rounded-full px-3 text-xs font-medium text-blue-900 hover:bg-blue-100 dark:text-blue-200 dark:hover:bg-blue-900/40"
          >
            {scope === "mine" ? "Widen to My Departments" : "Show All Accessible"}
          </Button>
        </div>
      )}

      {/* Filters — refinement only; visibility is controlled by the scope toggle above */}
      <div className="-mx-4 sm:mx-0 mb-6 overflow-x-auto">
        <div className="flex flex-nowrap sm:flex-wrap gap-3 px-4 sm:px-0 min-w-min">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {showEmployeeFilter && (
          <Select value={filterEmployee} onValueChange={setFilterEmployee}>
            <SelectTrigger className="w-[180px] flex-shrink-0">
              <User className="w-3.5 h-3.5 mr-1.5 text-muted-foreground flex-shrink-0" />
              <SelectValue placeholder="All employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {(users as UserProfileMini[]).map(u => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {(projects as Project[]).map(p => (
              <SelectItem key={p.id} value={String(p.id)}>{p.company} - {p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="backlog">Backlog</SelectItem>
            <SelectItem value="new_tasks">New Tasks</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="in_review">In Review</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : projectBuckets.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <CheckSquare className="w-12 h-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">
            No tasks match the current scope and filters.
          </p>
          {scope !== "all" && (
            <Button variant="outline" className="mt-4" onClick={() => setScope("all")}>
              <Globe className="w-4 h-4 mr-2" />
              Show All Accessible
            </Button>
          )}
          <Button className="mt-3" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Task
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {projectBuckets.map(pb => {
            const pKey = pb.id ?? OTHER_PROJECT_KEY;
            const pOpen = !collapsedProjects.has(pKey);
            return (
              <Collapsible
                key={`p-${pKey}`}
                open={pOpen}
                onOpenChange={() => toggleProject(pKey)}
                className="rounded-lg border bg-card"
              >
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-muted/50 transition-colors text-left rounded-lg">
                    {pOpen
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    }
                    <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex items-baseline gap-2 min-w-0 flex-1">
                      <span className="font-semibold text-sm truncate">{pb.name}</span>
                      {pb.projectIdLabel && (
                        <span className="text-xs text-muted-foreground font-mono flex-shrink-0">
                          {pb.projectIdLabel}
                        </span>
                      )}
                      {pb.company && (
                        <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                          · {pb.company}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-md">
                        {pb.taskCount}
                      </span>
                      {pb.overdueCount > 0 && (
                        <span
                          className="text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 px-2 py-0.5 rounded-md"
                          title={`${pb.overdueCount} overdue`}
                        >
                          {pb.overdueCount} overdue
                        </span>
                      )}
                      {pb.completeCount > 0 && (
                        <span
                          className="text-xs bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-2 py-0.5 rounded-md"
                          title={`${pb.completeCount} complete`}
                        >
                          {pb.completeCount} done
                        </span>
                      )}
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-2 sm:px-3 pb-3 pt-1 space-y-2">
                    {pb.depts.map(db => {
                      const dKey = `${pKey}:${db.id ?? OTHER_DEPT_KEY}`;
                      const dOpen = !collapsedDepts.has(dKey);
                      return (
                        <Collapsible
                          key={dKey}
                          open={dOpen}
                          onOpenChange={() => toggleDept(dKey)}
                        >
                          <CollapsibleTrigger asChild>
                            <button className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-muted transition-colors text-left">
                              {dOpen
                                ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                              }
                              {db.color && (
                                <span
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: db.color }}
                                />
                              )}
                              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {db.name}
                              </span>
                              <span className="text-xs text-muted-foreground/70 font-normal">
                                {db.tasks.length}
                              </span>
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-2 pb-1 px-1">
                              {db.tasks.map((task: Task, i: number) => (
                                <motion.div
                                  key={task.id}
                                  initial={{ opacity: 0, y: 8 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: Math.min(i * 0.02, 0.2) }}
                                >
                                  <TaskCard task={task} />
                                </motion.div>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}

      <NewTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultProjectId={defaultProjectId} />
    </div>
  );
}
