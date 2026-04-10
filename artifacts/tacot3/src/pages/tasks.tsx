import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { Plus, Search, Loader2, CheckSquare, Filter } from "lucide-react";
import type { Project, Department, UserProfileMini, Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSearch } from "wouter";
import TaskCard from "@/components/tasks/TaskCard";
import { motion } from "framer-motion";

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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5" />
            New Task
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Title *</Label>
            <Input
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              placeholder="Task description..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Project *</Label>
              <Select value={form.projectId} onValueChange={v => setForm(p => ({ ...p, projectId: v, departmentId: NONE }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {(projects as Project[]).map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
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
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Task details..."
                rows={3}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.title || !form.projectId || mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Create Task
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TasksPage() {
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const defaultProjectId = params.get("projectId") ? Number(params.get("projectId")) : undefined;

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterProject, setFilterProject] = useState(defaultProjectId ? String(defaultProjectId) : "all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });

  const queryParams = new URLSearchParams();
  if (filterProject !== "all") queryParams.set("projectId", filterProject);
  if (filterStatus !== "all") queryParams.set("status", filterStatus);
  queryParams.set("topLevelOnly", "true");

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", filterProject, filterStatus],
    queryFn: () => apiClient.get(`/tasks?${queryParams.toString()}`).then(r => r.data),
  });

  const filtered = (tasks as Task[]).filter(t => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterPriority !== "all" && t.priority !== filterPriority) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-muted-foreground text-sm mt-1">{filtered.length} tasks</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Task
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {(projects as Project[]).map(p => (
              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
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

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <CheckSquare className="w-12 h-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No tasks found</p>
          <Button className="mt-4" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create first task
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((task: Task, i: number) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <TaskCard task={task} />
            </motion.div>
          ))}
        </div>
      )}

      <NewTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultProjectId={defaultProjectId} />
    </div>
  );
}
