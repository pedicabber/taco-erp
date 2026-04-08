import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import {
  ArrowLeft, Plus, Settings, Loader2, Building2, FileText,
  Calendar, CheckSquare, MoreHorizontal, Trash2, Edit2,
  FolderKanban
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Separator } from "@/components/ui/separator";
import TaskCard from "@/components/tasks/TaskCard";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  on_hold: "outline",
  cancelled: "destructive",
};

function DeptDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const COLORS = ["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4"];
  const [form, setForm] = useState({ name: "", color: COLORS[0] });

  const mutation = useMutation({
    mutationFn: (data: { name: string; color: string; projectId: number }) =>
      apiClient.post("/departments", data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["departments", projectId] });
      toast({ title: "Department created" });
      onOpenChange(false);
      setForm({ name: "", color: COLORS[0] });
    },
    onError: () => toast({ title: "Failed to create department", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Department</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Name *</Label>
            <Input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Engineering, Welding"
            />
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex gap-2 mt-1">
              {COLORS.map(c => (
                <button
                  key={c}
                  className={`w-7 h-7 rounded-full transition-all ${form.color === c ? "ring-2 ring-offset-2 ring-foreground scale-110" : "hover:scale-105"}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setForm(p => ({ ...p, color: c }))}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate({ ...form, projectId })}
              disabled={!form.name || mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Create Department
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}`).then(r => r.data),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments", projectId],
    queryFn: () => apiClient.get(`/departments?projectId=${projectId}`).then(r => r.data as any[])
      .then(depts => depts.filter((d: any) => d.projectId === projectId)),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", { projectId }],
    queryFn: () => apiClient.get(`/tasks?projectId=${projectId}`).then(r => r.data),
  });

  const { data: summary } = useQuery({
    queryKey: ["project-summary", projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/summary`).then(r => r.data),
  });

  const deleteDept = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/departments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments", projectId] });
      toast({ title: "Department deleted" });
    },
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

  const completedTasks = tasks.filter((t: any) => t.status === "complete").length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/projects">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
            <ArrowLeft className="w-4 h-4" />
            Projects
          </button>
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FolderKanban className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{project.name}</h1>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {project.company && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Building2 className="w-3.5 h-3.5" />
                      {project.company}
                    </span>
                  )}
                  {project.projectId && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <FileText className="w-3.5 h-3.5" />
                      {project.projectId}
                    </span>
                  )}
                  {project.startDate && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5" />
                      Started {format(new Date(project.startDate), "MMM d, yyyy")}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {project.description && (
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{project.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANTS[project.status] ?? "secondary"} className="capitalize">
              {project.status.replace("_", " ")}
            </Badge>
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
            <FolderKanban className="w-5 h-5 text-orange-500" />
            <div>
              <div className="text-lg font-bold">{departments.length}</div>
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

      <div className="grid md:grid-cols-3 gap-6">
        {/* Departments */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Departments</h2>
            <Button size="sm" variant="outline" onClick={() => setDeptDialogOpen(true)}>
              <Plus className="w-3 h-3 mr-1" />
              Add
            </Button>
          </div>
          {departments.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-sm text-muted-foreground">No departments yet</p>
                <Button size="sm" className="mt-3" onClick={() => setDeptDialogOpen(true)}>
                  <Plus className="w-3 h-3 mr-1" />
                  Add Department
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {departments.map((dept: any) => {
                const deptTasks = tasks.filter((t: any) => t.departmentId === dept.id);
                return (
                  <Card key={dept.id}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: dept.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{dept.name}</div>
                        <div className="text-xs text-muted-foreground">{deptTasks.length} tasks</div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => deleteDept.mutate(dept.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Tasks */}
        <div className="md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Tasks</h2>
            <Link href={`/tasks?projectId=${projectId}`}>
              <Button size="sm" variant="outline">View all tasks</Button>
            </Link>
          </div>
          {tasks.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-sm text-muted-foreground">No tasks yet</p>
                <Link href={`/tasks?projectId=${projectId}`}>
                  <Button size="sm" className="mt-3">
                    <Plus className="w-3 h-3 mr-1" />
                    Create Task
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {tasks.slice(0, 10).map((task: any) => (
                <TaskCard key={task.id} task={task} compact />
              ))}
              {tasks.length > 10 && (
                <Link href={`/tasks?projectId=${projectId}`}>
                  <p className="text-sm text-muted-foreground text-center py-2 hover:text-foreground cursor-pointer">
                    View {tasks.length - 10} more tasks
                  </p>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <DeptDialog open={deptDialogOpen} onOpenChange={setDeptDialogOpen} projectId={projectId} />
    </div>
  );
}
