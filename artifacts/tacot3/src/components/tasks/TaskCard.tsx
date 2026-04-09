import { Link } from "wouter";
import { Clock, AlertTriangle, Play, Calendar, Zap, ChevronUp, Minus, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, isPast } from "date-fns";
import { useLiveTimer } from "@/hooks/useLiveTimer";

/** Parse a date-only string (YYYY-MM-DD) as LOCAL midnight, not UTC midnight. */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const STATUS_STYLES: Record<string, string> = {
  backlog:     "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  new_tasks:   "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  in_review:   "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  blocked:     "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  complete:    "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

const STATUS_FALLBACK = "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";

type Priority = "urgent" | "high" | "medium" | "low";

const PRIORITY_CONFIG: Record<
  Priority,
  { Icon: React.ElementType; color: string; label: string }
> = {
  urgent: { Icon: Zap,         color: "#ef4444", label: "Urgent" },
  high:   { Icon: ChevronUp,   color: "#f97316", label: "High"   },
  medium: { Icon: Minus,       color: "#eab308", label: "Medium" },
  low:    { Icon: ChevronDown, color: "#3b82f6", label: "Low"    },
};

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority as Priority] ?? PRIORITY_CONFIG.medium;
  const { Icon, color, label } = cfg;
  return (
    <span className="flex items-center gap-0.5 text-[10px] font-medium uppercase">
      <Icon style={{ color, width: 11, height: 11, flexShrink: 0 }} />
      <span style={{ color }}>{label}</span>
    </span>
  );
}

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Compact relative time: "in 24h", "2d ago", etc. */
function compactDueDate(date: Date): string {
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const past = diff < 0;
  const mins = Math.round(abs / 60000);
  const hrs = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let label: string;
  if (mins < 60) label = `${mins}m`;
  else if (hrs < 24) label = `${hrs}h`;
  else label = `${days}d`;
  return past ? `${label} ago` : `in ${label}`;
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
  const isOverdue = !!(task.dueDate && isPast(parseLocalDate(task.dueDate)) && task.status !== "complete");
  const isOverTime = !!(task.expectedHours && elapsed > task.expectedHours * 3600);

  const deptColor = task.department?.color ?? null;

  if (compact) {
    return (
      <Link href={`/tasks/${task.id}`}>
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted cursor-pointer transition-colors">
          <div className={cn("w-2 h-2 rounded-full flex-shrink-0", STATUS_STYLES[task.status] || "bg-gray-400")} />
          <span className="text-sm flex-1 truncate">{task.title}</span>
          {task.timerRunning && <Play className="w-3 h-3 text-green-500 animate-pulse flex-shrink-0" />}
          {isOverdue && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />}
        </div>
      </Link>
    );
  }

  /* Border colour priority: overdue > overtime > department > default */
  const borderStyle: React.CSSProperties = isOverdue
    ? { borderColor: "#f87171" }
    : isOverTime
    ? { borderColor: "#fb923c" }
    : deptColor
    ? { borderColor: deptColor }
    : {};

  return (
    <Link href={`/tasks/${task.id}`}>
      <Card
        draggable={draggable}
        onDragStart={onDragStart}
        className="cursor-pointer hover:shadow-md transition-all border"
        style={borderStyle}
      >
        <CardContent className="p-3">
          {/* Priority + Department */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <PriorityBadge priority={task.priority} />
            {deptColor && task.department && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ backgroundColor: `${deptColor}20`, color: deptColor }}
              >
                {task.department.name}
              </span>
            )}
          </div>

          {/* Title */}
          <p className="text-sm font-medium line-clamp-2 mb-2">{task.title}</p>

          {/* Status badge row — flex with overflow guard */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-md font-medium capitalize flex-shrink-0",
              STATUS_STYLES[task.status] ?? STATUS_FALLBACK,
            )}>
              {task.status.replace(/_/g, " ")}
            </span>

            <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
              {isOverdue && <AlertTriangle className="w-3 h-3 text-red-500" />}
              {task.dueDate && !isOverdue && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 whitespace-nowrap">
                  <Calendar className="w-2.5 h-2.5" />
                  {compactDueDate(parseLocalDate(task.dueDate))}
                </span>
              )}
              <span className={cn(
                "text-[10px] flex items-center gap-0.5 whitespace-nowrap",
                isOverTime ? "text-orange-500" : "text-muted-foreground",
              )}>
                {task.timerRunning
                  ? <Play className="w-2.5 h-2.5 text-green-500" />
                  : <Clock className="w-2.5 h-2.5" />}
                {formatSeconds(elapsed)}
                {task.expectedHours && <span>/{task.expectedHours}h</span>}
              </span>
            </div>
          </div>

          {/* Assignee */}
          {task.assignee && (
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
              {task.assignee.avatarUrl ? (
                <img
                  src={task.assignee.avatarUrl}
                  alt={task.assignee.name}
                  className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-medium flex-shrink-0">
                  {task.assignee.name?.[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-[10px] text-muted-foreground truncate">{task.assignee.name}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
