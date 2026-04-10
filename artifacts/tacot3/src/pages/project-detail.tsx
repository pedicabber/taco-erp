import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import { formatQuoteNum } from "@/lib/utils";
import type { Task, Project } from "@/lib/types";
import {
  ArrowLeft, Loader2, Building2, FileText,
  Calendar, CheckSquare, FolderKanban, Info, Users, ChevronDown,
} from "lucide-react";
import ProjectInfoDialog from "@/components/projects/ProjectInfoDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";
import { format } from "date-fns";
import TaskCard from "@/components/tasks/TaskCard";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ProjectAttachmentsPanel from "@/components/projects/ProjectAttachmentsPanel";

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
  const qc = useQueryClient();

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

  // Derive "Involved Departments" from task.department (resolved: task's own OR assignee's dept)
  const involvedDeptMap = new Map<number, { id: number; name: string; color: string | null; count: number }>();
  for (const task of tasks as Task[]) {
    const d = task.department;
    if (!d) continue;
    const existing = involvedDeptMap.get(d.id);
    if (existing) {
      existing.count++;
    } else {
      involvedDeptMap.set(d.id, { id: d.id, name: d.name, color: d.color, count: 1 });
    }
  }
  const involvedDepartments = [...involvedDeptMap.values()].sort((a, b) => b.count - a.count);

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
                      {formatQuoteNum(project.projectId)}
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

      <div className="grid md:grid-cols-3 gap-6">
        {/* Involved Departments */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-semibold">Involved Departments</h2>
          </div>
          {involvedDepartments.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {tasks.length === 0
                    ? "No tasks yet — departments appear here once tasks are assigned."
                    : "No departments assigned to tasks in this project."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {involvedDepartments.map(dept => (
                <Card key={dept.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: dept.color ?? "#6B7280" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{dept.name}</div>
                      <div className="text-xs text-muted-foreground">{dept.count} task{dept.count !== 1 ? "s" : ""}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
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
                    Create Task
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {(tasks as Task[]).map(task => (
                <TaskCard key={task.id} task={task} compact />
              ))}
            </div>
          )}
        </div>
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
