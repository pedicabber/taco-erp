import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import {
  Plus, Loader2, Trello, Settings2, Trash2,
  ChevronUp, ChevronDown, Check, X,
} from "lucide-react";
import type { Project, Department, KanbanColumn } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import TaskCard from "@/components/tasks/TaskCard";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";

type ColumnConfig = {
  id: number;
  statusKey: string;
  label: string;
  hexColor: string;
  sortOrder: number;
};

type KanbanTask = {
  id: number;
  title: string;
  status: string;
  priority: string;
  elapsedSeconds: number;
  timerRunning: boolean;
  timerStartedAt: string | null;
  expectedHours: number | null;
  dueDate: string | null;
  assignee?: { name: string; avatarUrl: string | null } | null;
  department?: { name: string; color: string | null } | null;
};

export default function BoardPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filterProject, setFilterProject] = useState("all");
  const [filterDept, setFilterDept] = useState("all");
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);

  const [showColumnManager, setShowColumnManager] = useState(false);
  const [editingColId, setEditingColId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [showAddCol, setShowAddCol] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");

  const boardRef = useRef<HTMLDivElement>(null);

  // Redirect vertical wheel → horizontal scroll on the board track.
  // Exception: if the cursor is over a column task list that can scroll vertically,
  // let the browser handle it natively (column scrolls down).
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // already horizontal
      if (e.deltaY === 0) return;

      // If cursor is over a scrollable column task list, let it scroll vertically
      const colTaskList = (e.target as HTMLElement).closest("[data-col-tasks]") as HTMLElement | null;
      if (colTaskList && colTaskList.scrollHeight > colTaskList.clientHeight) return;

      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Mouse drag-to-scroll on the board track.
  // Exception: don't initiate board drag when clicking inside a scrollable column.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[draggable]")) return;
      if ((e.target as HTMLElement).closest("button, input, select, a, [role='button']")) return;
      // Don't hijack drag inside a scrollable column task list
      const colTaskList = (e.target as HTMLElement).closest("[data-col-tasks]") as HTMLElement | null;
      if (colTaskList && colTaskList.scrollHeight > colTaskList.clientHeight) return;
      isDown = true;
      startX = e.pageX - el.offsetLeft;
      scrollLeft = el.scrollLeft;
      el.style.cursor = "grabbing";
      el.style.userSelect = "none";
    };
    const onMouseLeave = () => { isDown = false; el.style.cursor = ""; el.style.userSelect = ""; };
    const onMouseUp = () => { isDown = false; el.style.cursor = ""; el.style.userSelect = ""; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - el.offsetLeft;
      el.scrollLeft = scrollLeft - (x - startX);
    };
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mouseleave", onMouseLeave);
    el.addEventListener("mouseup", onMouseUp);
    el.addEventListener("mousemove", onMouseMove);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("mouseleave", onMouseLeave);
      el.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiClient.get("/departments").then(r => r.data),
  });

  const { data: columnConfigs = [], isLoading: loadingConfigs } = useQuery<ColumnConfig[]>({
    queryKey: ["kanban-columns"],
    queryFn: () => apiClient.get("/kanban/columns").then(r => r.data),
  });

  const queryParams = new URLSearchParams();
  if (filterProject !== "all") queryParams.set("projectId", filterProject);
  if (filterDept !== "all") queryParams.set("departmentId", filterDept);

  const { data: columns = [], isLoading: loadingTasks } = useQuery({
    queryKey: ["kanban", filterProject, filterDept],
    queryFn: () => apiClient.get(`/kanban?${queryParams.toString()}`).then(r => r.data),
    refetchInterval: 15000,
  });

  const isLoading = loadingConfigs || loadingTasks;

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: number; status: string }) =>
      apiClient.patch(`/tasks/${taskId}`, { status }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () => toast({ title: "Failed to move task", variant: "destructive" }),
  });

  const createColMutation = useMutation({
    mutationFn: (data: { label: string; hexColor: string }) =>
      apiClient.post("/kanban/columns", data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban-columns"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      setNewLabel("");
      setNewColor("#6b7280");
      setShowAddCol(false);
      toast({ title: "Column created" });
    },
    onError: () => toast({ title: "Failed to create column", variant: "destructive" }),
  });

  const updateColMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; label?: string; hexColor?: string; sortOrder?: number }) =>
      apiClient.patch(`/kanban/columns/${id}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban-columns"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      setEditingColId(null);
    },
    onError: () => toast({ title: "Failed to update column", variant: "destructive" }),
  });

  const deleteColMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/kanban/columns/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kanban-columns"] });
      qc.invalidateQueries({ queryKey: ["kanban"] });
      toast({ title: "Column deleted" });
    },
    onError: () => toast({
      title: "Cannot delete column",
      description: "Move all tasks out of this column first.",
      variant: "destructive",
    }),
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
      const allTasks = (columns as KanbanColumn[]).flatMap(c => c.tasks as KanbanTask[]);
      const task = allTasks.find(t => t.id === taskId);
      if (task && task.status !== status) {
        updateStatusMutation.mutate({ taskId, status });
      }
    }
    setDraggingTaskId(null);
    setDragOverStatus(null);
  }

  function moveCol(id: number, dir: -1 | 1) {
    const sorted = [...columnConfigs].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex(c => c.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[newIdx];
    updateColMutation.mutate({ id: a.id, sortOrder: b.sortOrder });
    updateColMutation.mutate({ id: b.id, sortOrder: a.sortOrder });
  }

  const filteredDepts = filterProject !== "all"
    ? (departments as Department[]).filter(d => d.projectId === Number(filterProject))
    : departments as Department[];

  const sortedConfigs = [...(columnConfigs as ColumnConfig[])].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 md:px-6 py-3 border-b border-border bg-card flex-shrink-0">
        <Trello className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        <span className="font-semibold hidden sm:block">Kanban Board</span>
        <div className="flex-1" />
        <Select value={filterProject} onValueChange={v => { setFilterProject(v); setFilterDept("all"); }}>
          <SelectTrigger className="w-[130px] sm:w-[180px]">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {(projects as Project[]).map(p => (
              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterDept} onValueChange={setFilterDept}>
          <SelectTrigger className="w-[110px] sm:w-[160px]">
            <SelectValue placeholder="All depts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {filteredDepts.map((d: Department) => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={() => setShowColumnManager(true)}
          title="Manage columns"
        >
          <Settings2 className="w-4 h-4" />
        </Button>
        <Link href="/tasks">
          <Button size="sm" className="flex-shrink-0">
            <Plus className="w-4 h-4 sm:mr-1" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </Link>
      </div>

      {/* Board — single horizontal scroll, columns scroll vertically internally */}
      {isLoading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div
          ref={boardRef}
          className="flex-1 overflow-x-auto overflow-y-hidden p-3 md:p-4 scrollbar-hide cursor-grab active:cursor-grabbing"
          style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        >
          <div
            className="flex gap-3 h-full"
            style={{ minWidth: `${sortedConfigs.length * 272}px` }}
          >
            {sortedConfigs.map(col => {
              const colData = (columns as KanbanColumn[]).find(c => c.status === col.statusKey);
              const tasks = (colData?.tasks ?? []) as KanbanTask[];
              const isDragOver = dragOverStatus === col.statusKey;

              return (
                <div
                  key={col.statusKey}
                  className={cn(
                    "flex flex-col w-[260px] flex-shrink-0 rounded-xl border-t-4 bg-muted/40 min-h-0 transition-colors",
                    isDragOver && "bg-muted/80 ring-2 ring-primary/30"
                  )}
                  style={{ borderTopColor: col.hexColor }}
                  onDragOver={e => handleDragOver(e, col.statusKey)}
                  onDrop={e => handleDrop(e, col.statusKey)}
                  onDragLeave={() => setDragOverStatus(null)}
                >
                  {/* Column header */}
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-card border-b border-border rounded-t-xl flex-shrink-0">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: col.hexColor }}
                    />
                    <span className="text-sm font-semibold truncate flex-1">{col.label}</span>
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full flex-shrink-0">
                      {tasks.length}
                    </span>
                  </div>

                  {/* Tasks — internal vertical scroll */}
                  <div
                    data-col-tasks="true"
                    className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2 min-h-0 col-scroll"
                    style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
                  >
                    <AnimatePresence>
                      {tasks.map(task => (
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
                        "flex items-center justify-center h-20 text-xs text-muted-foreground rounded-lg border-2 border-dashed border-border",
                        isDragOver && "border-primary/50 bg-primary/5 text-primary"
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

      {/* Column Manager Dialog */}
      <Dialog open={showColumnManager} onOpenChange={setShowColumnManager}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Board Columns</DialogTitle>
          </DialogHeader>

          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {sortedConfigs.map((col, idx) => (
              <div
                key={col.id}
                className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30"
              >
                {/* Color picker dot */}
                <label className="flex-shrink-0 cursor-pointer relative" title="Click to change color">
                  <div
                    className="w-7 h-7 rounded-full border-2 border-white/20 hover:scale-110 transition-transform"
                    style={{ backgroundColor: col.hexColor }}
                  />
                  <input
                    type="color"
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    value={col.hexColor}
                    onChange={e => updateColMutation.mutate({ id: col.id, hexColor: e.target.value })}
                  />
                </label>

                {/* Editable name */}
                {editingColId === col.id ? (
                  <div className="flex-1 flex items-center gap-1 min-w-0">
                    <Input
                      value={editLabel}
                      onChange={e => setEditLabel(e.target.value)}
                      className="h-7 text-sm flex-1 min-w-0"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === "Enter") updateColMutation.mutate({ id: col.id, label: editLabel });
                        if (e.key === "Escape") setEditingColId(null);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 flex-shrink-0"
                      onClick={() => updateColMutation.mutate({ id: col.id, label: editLabel })}
                    >
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 flex-shrink-0"
                      onClick={() => setEditingColId(null)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <span
                    className="flex-1 text-sm font-medium cursor-pointer hover:underline truncate min-w-0"
                    title="Click to rename"
                    onClick={() => { setEditingColId(col.id); setEditLabel(col.label); }}
                  >
                    {col.label}
                  </span>
                )}

                {/* Up / Down reorder */}
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    disabled={idx === 0 || updateColMutation.isPending}
                    onClick={() => moveCol(col.id, -1)}
                  >
                    <ChevronUp className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    disabled={idx === sortedConfigs.length - 1 || updateColMutation.isPending}
                    onClick={() => moveCol(col.id, 1)}
                  >
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </div>

                {/* Delete */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive flex-shrink-0"
                  onClick={() => deleteColMutation.mutate(col.id)}
                  disabled={deleteColMutation.isPending}
                  title="Delete column (must be empty)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* Add new column */}
          {showAddCol ? (
            <div className="flex items-center gap-2 pt-3 border-t border-border">
              <label className="flex-shrink-0 cursor-pointer relative" title="Pick color">
                <div
                  className="w-7 h-7 rounded-full border-2 border-white/20"
                  style={{ backgroundColor: newColor }}
                />
                <input
                  type="color"
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  value={newColor}
                  onChange={e => setNewColor(e.target.value)}
                />
              </label>
              <Input
                placeholder="Column name"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                className="flex-1 h-8 text-sm"
                autoFocus
                onKeyDown={e => {
                  if (e.key === "Enter" && newLabel.trim()) {
                    createColMutation.mutate({ label: newLabel.trim(), hexColor: newColor });
                  }
                  if (e.key === "Escape") setShowAddCol(false);
                }}
              />
              <Button
                size="sm"
                className="h-8 flex-shrink-0"
                disabled={!newLabel.trim() || createColMutation.isPending}
                onClick={() => createColMutation.mutate({ label: newLabel.trim(), hexColor: newColor })}
              >
                {createColMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Add"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                onClick={() => setShowAddCol(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full mt-2"
              onClick={() => { setShowAddCol(true); setNewLabel(""); setNewColor("#6b7280"); }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Column
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
