import { Link } from "wouter";
import { Clock, AlertTriangle, Play, Square, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, isPast } from "date-fns";
import { useLiveTimer } from "@/hooks/useLiveTimer";

const STATUS_STYLES: Record<string, string> = {
  backlog: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  in_review: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  complete: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "text-muted-foreground",
  medium: "text-yellow-500",
  high: "text-orange-500",
  urgent: "text-red-500",
};

const PRIORITY_ICONS: Record<string, string> = {
  low: "▽",
  medium: "△",
  high: "▲",
  urgent: "▲▲",
};

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface Task {
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
}

export default function TaskCard({
  task,
  compact = false,
  draggable,
  onDragStart,
}: {
  task: Task;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const elapsed = useLiveTimer(task.elapsedSeconds, task.timerRunning, task.timerStartedAt);
  const isOverdue = task.dueDate && isPast(new Date(task.dueDate)) && task.status !== "complete";
  const isOverTime = task.expectedHours && elapsed > task.expectedHours * 3600;

  if (compact) {
    return (
      <Link href={`/tasks/${task.id}`}>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted cursor-pointer transition-colors">
          <div className={cn("w-2 h-2 rounded-full flex-shrink-0", STATUS_STYLES[task.status] || "bg-gray-400")} />
          <span className="text-sm flex-1 truncate">{task.title}</span>
          {task.timerRunning && (
            <Play className="w-3 h-3 text-green-500 animate-pulse flex-shrink-0" />
          )}
          {isOverdue && (
            <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/tasks/${task.id}`}>
      <Card
        draggable={draggable}
        onDragStart={onDragStart}
        className={cn(
          "cursor-pointer hover:shadow-md transition-all border",
          draggable && "active:opacity-70",
          isOverdue && "border-red-300 dark:border-red-800",
          isOverTime && !isOverdue && "border-orange-300 dark:border-orange-800"
        )}
      >
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <span className={cn("text-[10px] font-medium uppercase", PRIORITY_STYLES[task.priority])}>
              {PRIORITY_ICONS[task.priority]} {task.priority}
            </span>
            {task.department && (() => {
              const c = task.department.color ?? "#6B7280";
              return (
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: `${c}20`, color: c }}
                >
                  {task.department.name}
                </span>
              );
            })()}
          </div>

          <p className="text-sm font-medium line-clamp-2 mb-2">{task.title}</p>

          <div className="flex items-center justify-between gap-2">
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md font-medium capitalize", STATUS_STYLES[task.status])}>
              {task.status.replace("_", " ")}
            </span>

            <div className="flex items-center gap-2">
              {isOverdue && <AlertTriangle className="w-3 h-3 text-red-500" />}
              {task.dueDate && !isOverdue && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Calendar className="w-2.5 h-2.5" />
                  {formatDistanceToNow(new Date(task.dueDate), { addSuffix: true })}
                </span>
              )}
              <span className={cn("text-[10px] flex items-center gap-0.5", isOverTime ? "text-orange-500" : "text-muted-foreground")}>
                {task.timerRunning ? (
                  <Play className="w-2.5 h-2.5 text-green-500" />
                ) : (
                  <Clock className="w-2.5 h-2.5" />
                )}
                {formatSeconds(elapsed)}
                {task.expectedHours && (
                  <span>/{task.expectedHours}h</span>
                )}
              </span>
            </div>
          </div>

          {task.assignee && (
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
              <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium flex-shrink-0">
                {task.assignee.name?.[0]?.toUpperCase()}
              </div>
              <span className="text-[10px] text-muted-foreground truncate">{task.assignee.name}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
