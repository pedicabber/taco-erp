import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { ChevronLeft, ChevronRight, CalendarDays, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { Link } from "wouter";
import { useLiveTimer } from "@/hooks/useLiveTimer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const DEPT_FALLBACK = "#6B7280";

function TaskDot({ task }: { task: any }) {
  const elapsed = useLiveTimer(task.elapsedSeconds, task.timerRunning, task.timerStartedAt);
  const color = task.departmentColor ?? DEPT_FALLBACK;
  const isOverTime = task.expectedHours && elapsed > task.expectedHours * 3600;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={`/tasks/${task.taskId}`}>
          <div
            className="text-[10px] font-medium px-1.5 py-0.5 rounded truncate cursor-pointer hover:opacity-80 transition-opacity max-w-full"
            style={{ backgroundColor: `${color}25`, color, borderLeft: `2px solid ${color}` }}
          >
            <span className="flex items-center gap-1">
              {task.timerRunning && <Clock className="w-2 h-2 flex-shrink-0" />}
              <span className="truncate">{task.title}</span>
              {isOverTime && <span className="flex-shrink-0 text-orange-500">!</span>}
            </span>
          </div>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px]">
        <div className="space-y-1">
          <div className="font-medium text-sm">{task.title}</div>
          <div className="text-xs text-muted-foreground">{task.projectName}</div>
          {task.expectedHours && (
            <div className="text-xs">
              Expected: {task.expectedHours}h |
              Elapsed: {(elapsed / 3600).toFixed(1)}h
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function GanttRow({ task }: { task: any }) {
  const elapsed = useLiveTimer(task.elapsedSeconds, task.timerRunning, task.timerStartedAt);
  if (!task.startDate && !task.dueDate) return null;

  const color = task.departmentColor ?? DEPT_FALLBACK;
  const isOverTime = task.expectedHours && elapsed > task.expectedHours * 3600;

  return (
    <div className="flex items-center gap-3 py-2 border-b border-border last:border-0">
      <Link href={`/tasks/${task.taskId}`}>
        <div className="text-sm hover:text-primary cursor-pointer w-48 truncate">{task.title}</div>
      </Link>
      <div className="flex-1 relative h-7 flex items-center">
        {/* Expected timeline bar */}
        {task.startDate && task.dueDate && (
          <div
            className="h-3 rounded-full opacity-30 absolute"
            style={{ backgroundColor: color, left: 0, right: 0 }}
          />
        )}
        {/* Actual elapsed bar */}
        {task.expectedHours && (
          <div
            className={cn("h-3 rounded-full absolute", isOverTime ? "opacity-90" : "opacity-70")}
            style={{
              backgroundColor: isOverTime ? "#f97316" : color,
              width: `${Math.min(100, (elapsed / (task.expectedHours * 3600)) * 100)}%`,
              left: 0,
            }}
          />
        )}
        {task.timerRunning && (
          <div className="absolute right-1 flex items-center gap-0.5">
            <Clock className="w-3 h-3 text-primary animate-pulse" />
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground w-20 text-right flex-shrink-0">
        {task.expectedHours ? `${(elapsed / 3600).toFixed(1)}/${task.expectedHours}h` : "—"}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "gantt">("month");
  const [filterProject, setFilterProject] = useState("all");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });

  const queryParams = new URLSearchParams();
  if (filterProject !== "all") queryParams.set("projectId", filterProject);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["calendar-events", filterProject],
    queryFn: () => apiClient.get(`/calendar/events?${queryParams.toString()}`).then(r => r.data),
    refetchInterval: 15000,
  });

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  function getTasksForDay(date: Date) {
    return (events as any[]).filter(e => {
      const start = e.startDate ? new Date(e.startDate) : null;
      const due = e.dueDate ? new Date(e.dueDate) : null;
      if (!start && !due) return false;
      const dateStr = format(date, "yyyy-MM-dd");
      if (start && format(start, "yyyy-MM-dd") === dateStr) return true;
      if (due && format(due, "yyyy-MM-dd") === dateStr) return true;
      return false;
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card">
        <CalendarDays className="w-5 h-5 text-muted-foreground" />
        <span className="font-semibold">Calendar</span>
        <div className="flex-1" />
        <Select value={filterProject} onValueChange={setFilterProject}>
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
        <div className="flex items-center bg-muted rounded-lg p-0.5">
          <Button
            variant={view === "month" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("month")}
            className="h-7"
          >
            Month
          </Button>
          <Button
            variant={view === "gantt" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("gantt")}
            className="h-7"
          >
            Gantt
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(d => subMonths(d, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium w-28 text-center">{format(currentDate, "MMMM yyyy")}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(d => addMonths(d, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCurrentDate(new Date())} className="h-8">
            Today
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : view === "month" ? (
        <div className="flex-1 overflow-auto p-4">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <div key={d} className="text-xs font-semibold text-muted-foreground text-center py-1">
                {d}
              </div>
            ))}
          </div>
          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map(day => {
              const dayTasks = getTasksForDay(day);
              const isCurrentMonth = isSameMonth(day, currentDate);
              const today = isToday(day);
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "min-h-[80px] rounded-lg p-1.5 border border-border text-xs",
                    !isCurrentMonth && "opacity-40 bg-muted/20",
                    today && "ring-2 ring-primary ring-offset-1"
                  )}
                >
                  <div className={cn(
                    "font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full",
                    today && "bg-primary text-primary-foreground"
                  )}>
                    {format(day, "d")}
                  </div>
                  <div className="space-y-0.5 overflow-hidden">
                    {dayTasks.slice(0, 3).map(task => (
                      <TaskDot key={`${task.taskId}-${day.toISOString()}`} task={task} />
                    ))}
                    {dayTasks.length > 3 && (
                      <div className="text-[10px] text-muted-foreground px-1">
                        +{dayTasks.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          {events.length > 0 && (
            <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-3 h-2 rounded-full bg-gray-300 opacity-30" />
                <span>Expected timeline</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-2 rounded-full bg-primary opacity-70" />
                <span>Actual progress</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-2 rounded-full bg-orange-500 opacity-70" />
                <span>Over expected</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Gantt view
        <div className="flex-1 overflow-auto p-4">
          <div className="max-w-4xl">
            <div className="flex items-center gap-3 mb-4 pb-2 border-b border-border text-xs font-semibold text-muted-foreground">
              <div className="w-48">Task</div>
              <div className="flex-1">Timeline (expected vs actual)</div>
              <div className="w-20 text-right">Time</div>
            </div>
            {(events as any[]).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No tasks with dates found</p>
            ) : (
              (events as any[]).map(event => (
                <GanttRow key={event.taskId} task={event} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
