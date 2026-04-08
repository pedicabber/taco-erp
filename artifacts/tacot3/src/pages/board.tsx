import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { Plus, Loader2, Trello } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import TaskCard from "@/components/tasks/TaskCard";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";

const COLUMNS = [
  { status: "backlog", label: "Backlog", color: "border-t-slate-400" },
  { status: "in_progress", label: "In Progress", color: "border-t-blue-500" },
  { status: "in_review", label: "In Review", color: "border-t-purple-500" },
  { status: "blocked", label: "Blocked", color: "border-t-red-500" },
  { status: "complete", label: "Complete", color: "border-t-green-500" },
];

export default function BoardPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterProject, setFilterProject] = useState("all");
  const [filterDept, setFilterDept] = useState("all");
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiClient.get("/departments").then(r => r.data),
  });

  const queryParams = new URLSearchParams();
  if (filterProject !== "all") queryParams.set("projectId", filterProject);
  if (filterDept !== "all") queryParams.set("departmentId", filterDept);

  const { data: columns = [], isLoading } = useQuery({
    queryKey: ["kanban", filterProject, filterDept],
    queryFn: () => apiClient.get(`/kanban?${queryParams.toString()}`).then(r => r.data),
    refetchInterval: 15000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: number; status: string }) =>
      apiClient.patch(`/tasks/${taskId}`, { status }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () => toast({ title: "Failed to move task", variant: "destructive" }),
  });

  function handleDragStart(e: React.DragEvent, taskId: number) {
    setDraggingTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(taskId));
  }

  function handleDragOver(e: React.DragEvent, status: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStatus(status);
  }

  function handleDrop(e: React.DragEvent, status: string) {
    e.preventDefault();
    const taskId = Number(e.dataTransfer.getData("text/plain"));
    if (taskId && draggingTaskId === taskId) {
      const allTasks = (columns as any[]).flatMap((c: any) => c.tasks);
      const task = allTasks.find((t: any) => t.id === taskId);
      if (task && task.status !== status) {
        updateStatusMutation.mutate({ taskId, status });
      }
    }
    setDraggingTaskId(null);
    setDragOverStatus(null);
  }

  const filteredDepts = filterProject !== "all"
    ? (departments as any[]).filter((d: any) => d.projectId === Number(filterProject))
    : departments;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card">
        <Trello className="w-5 h-5 text-muted-foreground" />
        <span className="font-semibold">Kanban Board</span>
        <div className="flex-1" />
        <Select value={filterProject} onValueChange={v => { setFilterProject(v); setFilterDept("all"); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {(projects as any[]).map(p => (
              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterDept} onValueChange={setFilterDept}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All depts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {(filteredDepts as any[]).map(d => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link href="/tasks">
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1" />
            New Task
          </Button>
        </Link>
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-3 h-full min-h-0" style={{ minWidth: `${COLUMNS.length * 260}px` }}>
            {COLUMNS.map(col => {
              const colData = (columns as any[]).find(c => c.status === col.status);
              const tasks = colData?.tasks ?? [];
              const isDragOver = dragOverStatus === col.status;

              return (
                <div
                  key={col.status}
                  className={cn(
                    "flex flex-col w-[260px] flex-shrink-0 rounded-xl border-t-2 bg-muted/40 overflow-hidden transition-colors",
                    col.color,
                    isDragOver && "bg-muted/80"
                  )}
                  onDragOver={e => handleDragOver(e, col.status)}
                  onDrop={e => handleDrop(e, col.status)}
                  onDragLeave={() => setDragOverStatus(null)}
                >
                  {/* Column header */}
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-card border-b border-border">
                    <span className="text-sm font-semibold">{col.label}</span>
                    <span className="text-xs text-muted-foreground ml-auto bg-muted px-1.5 py-0.5 rounded-full">
                      {tasks.length}
                    </span>
                  </div>

                  {/* Tasks */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    <AnimatePresence>
                      {tasks.map((task: any) => (
                        <motion.div
                          key={task.id}
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.2 }}
                        >
                          <TaskCard
                            task={task}
                            draggable
                            onDragStart={e => handleDragStart(e, task.id)}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {tasks.length === 0 && (
                      <div className={cn(
                        "flex items-center justify-center h-20 text-sm text-muted-foreground rounded-lg border-2 border-dashed border-border",
                        isDragOver && "border-primary/50 bg-primary/5"
                      )}>
                        {isDragOver ? "Drop here" : "No tasks"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
