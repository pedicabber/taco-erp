import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { ChevronLeft, ChevronRight, CalendarDays, Loader2, Clock } from "lucide-react";
import type { Project, Department, UserProfileMini, CalendarEvent } from "@/lib/types";
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
  addDays,
  subDays,
  differenceInCalendarDays,
  min as dateMin,
  max as dateMax,
  startOfDay,
} from "date-fns";
import { Link } from "wouter";
import { useLiveTimer } from "@/hooks/useLiveTimer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const DEPT_FALLBACK = "#6B7280";
const DAY_PX = 44;
const DATE_NUM_H = 28; // px height reserved for the date number row
const LANE_H = 22;    // px height per spanning-event lane

/* ─── Tiny chip for single-day events ─────────────────────────── */
function TaskDot({ task }: { task: CalendarEvent }) {
  const elapsed = useLiveTimer(task.elapsedSeconds, task.timerRunning, null);
  const color = task.departmentColor ?? DEPT_FALLBACK;
  const isOverTime = !!(task.expectedHours && elapsed > task.expectedHours * 3600);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={`/tasks/${task.taskId}`}>
          <div
            className="text-[10px] font-medium px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80 transition-opacity w-full"
            style={{ backgroundColor: `${color}25`, color, borderLeft: `2px solid ${color}` }}
          >
            <span className="flex items-center gap-0.5">
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
              Expected: {task.expectedHours}h | Elapsed: {(elapsed / 3600).toFixed(1)}h
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/* ─── Types for the month-view event classification ───────────── */
interface SpanningBar {
  event: CalendarEvent;
  startCol: number; // 0-6 within this week
  endCol: number;   // 0-6 within this week
  isStart: boolean; // visually starts here (rounded left end)
  isEnd: boolean;   // visually ends here (rounded right end)
  lane: number;     // vertical stack index
}

/** Classify events for a single week row into spanning bars and single-day chips. */
function classifyWeekEvents(
  weekDays: Date[],
  events: CalendarEvent[],
  laneMap: Map<number, number>, // taskId → persisted lane across rows
) {
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const spanning: SpanningBar[] = [];
  const singleByDay = new Map<string, CalendarEvent[]>();

  for (const e of events) {
    const eStart = e.startDate ? startOfDay(new Date(e.startDate)) : null;
    const eDue = e.dueDate ? startOfDay(new Date(e.dueDate)) : null;
    if (!eStart && !eDue) continue;

    const effectiveStart = eStart ?? eDue!;
    const effectiveEnd = eDue ?? eStart!;
    const isMultiDay =
      eStart && eDue && differenceInCalendarDays(eDue, eStart) > 0;

    if (isMultiDay) {
      // Does this span overlap the current week?
      if (effectiveStart > weekEnd || effectiveEnd < weekStart) continue;

      const clipStart = effectiveStart < weekStart ? weekStart : effectiveStart;
      const clipEnd = effectiveEnd > weekEnd ? weekEnd : effectiveEnd;

      const startCol = weekDays.findIndex(d => isSameDay(d, clipStart));
      const endCol = weekDays.findIndex(d => isSameDay(d, clipEnd));

      // Assign / retrieve a stable lane for this event
      let lane = laneMap.get(e.taskId);
      if (lane === undefined) {
        // Find the first lane that doesn't conflict in this week
        const usedLanes = new Set(spanning.map(s => s.lane));
        let l = 0;
        while (usedLanes.has(l)) l++;
        lane = l;
        laneMap.set(e.taskId, lane);
      }

      spanning.push({
        event: e,
        startCol: startCol >= 0 ? startCol : 0,
        endCol: endCol >= 0 ? endCol : 6,
        isStart: isSameDay(clipStart, effectiveStart),
        isEnd: isSameDay(clipEnd, effectiveEnd),
        lane,
      });
    } else {
      // Single-day: show on whichever day it falls within this week
      for (const day of weekDays) {
        const hit =
          (eStart && isSameDay(day, eStart)) ||
          (eDue && !eStart && isSameDay(day, eDue));
        if (hit) {
          const key = format(day, "yyyy-MM-dd");
          if (!singleByDay.has(key)) singleByDay.set(key, []);
          singleByDay.get(key)!.push(e);
        }
      }
    }
  }

  return { spanning, singleByDay };
}

/* ─── Gantt view ───────────────────────────────────────────────── */
function GanttView({ events }: { events: CalendarEvent[] }) {
  const tasksWithDates = events.filter(e => e.startDate || e.dueDate);

  const { displayStart, days, totalPx } = useMemo(() => {
    const today = startOfDay(new Date());
    if (tasksWithDates.length === 0) {
      const s = subDays(today, 7);
      const e = addDays(today, 21);
      const d = eachDayOfInterval({ start: s, end: e });
      return { displayStart: s, displayEnd: e, days: d, totalPx: d.length * DAY_PX };
    }
    const allDates: Date[] = tasksWithDates.flatMap(ev => [
      ev.startDate ? startOfDay(new Date(ev.startDate)) : null,
      ev.dueDate ? startOfDay(new Date(ev.dueDate)) : null,
    ]).filter((d): d is Date => d !== null);

    const s = subDays(dateMin(allDates), 3);
    const e = addDays(dateMax(allDates), 3);
    const d = eachDayOfInterval({ start: s, end: e });
    return { displayStart: s, displayEnd: e, days: d, totalPx: d.length * DAY_PX };
  }, [tasksWithDates]);

  const weekGroups = useMemo(() => {
    const groups: { label: string; days: Date[] }[] = [];
    let i = 0;
    while (i < days.length) {
      const weekStart = startOfWeek(days[i], { weekStartsOn: 0 });
      const weekEnd = endOfWeek(days[i], { weekStartsOn: 0 });
      const group = days.filter(d => d >= weekStart && d <= weekEnd);
      const label = `${format(group[0], "MMM d")} – ${format(group[group.length - 1], "MMM d")}`;
      groups.push({ label, days: group });
      i += group.length;
    }
    return groups;
  }, [days]);

  const today = startOfDay(new Date());
  const todayOffset = differenceInCalendarDays(today, displayStart);
  const todayX = todayOffset >= 0 && todayOffset < days.length
    ? todayOffset * DAY_PX + DAY_PX / 2
    : null;

  const TASK_COL_W = 200;

  return (
    <div className="flex-1 overflow-auto">
      <div style={{ minWidth: TASK_COL_W + totalPx }}>
        {/* Sticky header */}
        <div className="sticky top-0 z-20 bg-card border-b border-border">
          <div className="flex">
            <div style={{ width: TASK_COL_W }} className="flex-shrink-0 border-r border-border" />
            {weekGroups.map(wg => (
              <div
                key={wg.label}
                className="text-xs font-semibold text-muted-foreground border-r border-border px-2 py-1 flex-shrink-0"
                style={{ width: wg.days.length * DAY_PX }}
              >
                {wg.label}
              </div>
            ))}
          </div>
          <div className="flex border-t border-border/50">
            <div
              style={{ width: TASK_COL_W }}
              className="flex-shrink-0 border-r border-border text-xs font-semibold text-muted-foreground px-3 py-1"
            >
              Task
            </div>
            {days.map(day => (
              <div
                key={day.toISOString()}
                style={{ width: DAY_PX }}
                className={cn(
                  "text-center text-xs py-1 border-r border-border flex-shrink-0 font-medium",
                  isSameDay(day, today) && "text-primary font-bold",
                  day.getDay() === 0 || day.getDay() === 6
                    ? "text-muted-foreground/60"
                    : "text-muted-foreground"
                )}
              >
                {format(day, "d")}
              </div>
            ))}
            <div className="w-20 flex-shrink-0 border-l border-border text-xs font-semibold text-muted-foreground px-2 py-1 text-right">
              Time
            </div>
          </div>
        </div>

        {/* Task rows */}
        {tasksWithDates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">No tasks with dates found</p>
        ) : (
          tasksWithDates.map(task => {
            const elapsed = task.elapsedSeconds ?? 0;
            const color = task.departmentColor ?? DEPT_FALLBACK;
            const isOverTime = !!(task.expectedHours && elapsed > task.expectedHours * 3600);

            const start = task.startDate ? startOfDay(new Date(task.startDate)) : null;
            const due = task.dueDate ? startOfDay(new Date(task.dueDate)) : null;
            const barStart = start ?? due!;
            const barEnd = due ?? start!;
            const barLeft = differenceInCalendarDays(barStart, displayStart) * DAY_PX;
            const barWidth = Math.max(DAY_PX, (differenceInCalendarDays(barEnd, barStart) + 1) * DAY_PX);
            const progressWidth = task.expectedHours
              ? Math.min(barWidth, (elapsed / (task.expectedHours * 3600)) * barWidth)
              : 0;

            return (
              <div
                key={task.taskId}
                className="flex items-stretch border-b border-border hover:bg-muted/20 transition-colors"
                style={{ height: 40 }}
              >
                <Link href={`/tasks/${task.taskId}`}>
                  <div
                    style={{ width: TASK_COL_W }}
                    className="flex-shrink-0 border-r border-border px-3 flex items-center text-sm hover:text-primary cursor-pointer truncate h-full"
                  >
                    {task.timerRunning && <Clock className="w-3 h-3 mr-1.5 text-primary animate-pulse flex-shrink-0" />}
                    <span className="truncate">{task.title}</span>
                  </div>
                </Link>
                <div className="relative flex-shrink-0" style={{ width: totalPx }}>
                  {days.map((day, i) => (
                    <div
                      key={i}
                      className={cn(
                        "absolute top-0 bottom-0 border-r",
                        day.getDay() === 0 || day.getDay() === 6
                          ? "border-border/30 bg-muted/10"
                          : "border-border/20"
                      )}
                      style={{ left: i * DAY_PX, width: DAY_PX }}
                    />
                  ))}
                  {todayX !== null && (
                    <div className="absolute top-0 bottom-0 w-px bg-primary/60 z-10" style={{ left: todayX }} />
                  )}
                  <div
                    className="absolute rounded"
                    style={{
                      left: barLeft, width: barWidth,
                      top: "50%", transform: "translateY(-50%)", height: 20,
                      backgroundColor: `${color}30`, border: `1px solid ${color}60`,
                    }}
                  >
                    {progressWidth > 0 && (
                      <div
                        className="absolute inset-y-0 left-0 rounded"
                        style={{ width: progressWidth, backgroundColor: isOverTime ? "#f97316" : color, opacity: 0.75 }}
                      />
                    )}
                    <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-medium truncate z-10" style={{ color }}>
                      {task.title}
                    </span>
                  </div>
                </div>
                <div className="w-20 flex-shrink-0 border-l border-border text-xs text-muted-foreground flex items-center justify-end px-2">
                  {task.expectedHours ? `${(elapsed / 3600).toFixed(1)}/${task.expectedHours}h` : "—"}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─── Month view ───────────────────────────────────────────────── */
function MonthView({ days, currentDate, events }: {
  days: Date[];
  currentDate: Date;
  events: CalendarEvent[];
}) {
  const weekRows = useMemo(() => {
    const rows: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [days]);

  // Stable lane assignments across all week rows (taskId → lane)
  const laneMap = useMemo(() => new Map<number, number>(), [events]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Weekday header */}
      <div className="grid grid-cols-7 flex-shrink-0 bg-card border-b border-border">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} className="text-xs font-semibold text-muted-foreground text-center py-2 border-r border-border last:border-r-0">
            {d}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {weekRows.map((weekDays, weekIdx) => {
          const { spanning, singleByDay } = classifyWeekEvents(weekDays, events, laneMap);
          const maxLane = spanning.length > 0 ? Math.max(...spanning.map(s => s.lane)) + 1 : 0;
          const spanAreaH = maxLane * LANE_H + (maxLane > 0 ? 4 : 0);
          const isLastWeek = weekIdx === weekRows.length - 1;

          return (
            <div
              key={weekIdx}
              className={cn("flex-1 relative min-h-[70px]", !isLastWeek && "border-b border-border")}
            >
              {/* Day columns */}
              <div className="absolute inset-0 grid grid-cols-7">
                {weekDays.map((day, colIdx) => {
                  const dayStr = format(day, "yyyy-MM-dd");
                  const dayEvents = singleByDay.get(dayStr) ?? [];
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const today = isToday(day);

                  return (
                    <div
                      key={colIdx}
                      className={cn(
                        "h-full flex flex-col border-r border-border overflow-hidden",
                        colIdx === 6 && "border-r-0",
                        !isCurrentMonth && "bg-muted/10"
                      )}
                    >
                      {/* Date number */}
                      <div className="flex-shrink-0 p-1" style={{ height: DATE_NUM_H }}>
                        <span
                          className={cn(
                            "text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full",
                            today && "bg-primary text-primary-foreground",
                            !today && !isCurrentMonth && "text-muted-foreground/40",
                            !today && isCurrentMonth && "text-foreground"
                          )}
                        >
                          {format(day, "d")}
                        </span>
                      </div>

                      {/* Reserve space for spanning bars */}
                      <div className="flex-shrink-0" style={{ height: spanAreaH }} />

                      {/* Single-day events — scrollable */}
                      <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-1 space-y-0.5 scrollbar-hide">
                        {dayEvents.map(task => (
                          <TaskDot key={task.taskId} task={task} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Spanning event bars (float above the grid) */}
              {spanning.map(span => {
                const color = span.event.departmentColor ?? DEPT_FALLBACK;
                const left = `${(span.startCol / 7) * 100}%`;
                const width = `${((span.endCol - span.startCol + 1) / 7) * 100}%`;
                const top = DATE_NUM_H + span.lane * LANE_H + 2;

                return (
                  <Link
                    key={`${span.event.taskId}-w${weekIdx}`}
                    href={`/tasks/${span.event.taskId}`}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className="absolute flex items-center text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity z-10 overflow-hidden"
                          style={{
                            top,
                            height: LANE_H - 4,
                            left: `calc(${left} + 2px)`,
                            width: `calc(${width} - 4px)`,
                            backgroundColor: `${color}22`,
                            color,
                            borderTop: `1px solid ${color}60`,
                            borderBottom: `1px solid ${color}60`,
                            borderLeft: span.isStart ? `3px solid ${color}` : "none",
                            borderRight: span.isEnd ? `1px solid ${color}60` : "none",
                            borderRadius: `${span.isStart ? 4 : 0}px ${span.isEnd ? 4 : 0}px ${span.isEnd ? 4 : 0}px ${span.isStart ? 4 : 0}px`,
                            paddingLeft: span.isStart ? 6 : 4,
                            paddingRight: 4,
                          }}
                        >
                          {span.isStart && (
                            <span className="truncate leading-none">{span.event.title}</span>
                          )}
                          {!span.isStart && (
                            /* continuation bar — show a subtle arrow-like spacer */
                            <span className="w-full h-full" />
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px]">
                        <div className="space-y-1">
                          <div className="font-medium text-sm">{span.event.title}</div>
                          {span.event.startDate && span.event.dueDate && (
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(span.event.startDate), "MMM d")} – {format(new Date(span.event.dueDate), "MMM d, yyyy")}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground">{span.event.projectName}</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Status list ──────────────────────────────────────────────── */
const TASK_STATUSES = [
  { value: "backlog", label: "Backlog" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "blocked", label: "Blocked" },
  { value: "complete", label: "Complete" },
];

/* ─── Page ─────────────────────────────────────────────────────── */
export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "gantt">("month");
  const [filterProject, setFilterProject] = useState("all");
  const [filterDepartment, setFilterDepartment] = useState("all");
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => apiClient.get("/projects").then(r => r.data) });
  const { data: departments = [] } = useQuery({ queryKey: ["departments"], queryFn: () => apiClient.get("/departments").then(r => r.data) });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => apiClient.get("/users").then(r => r.data) });

  const queryParams = new URLSearchParams();
  if (filterProject !== "all") queryParams.set("projectId", filterProject);
  if (filterDepartment !== "all") queryParams.set("departmentId", filterDepartment);
  if (filterAssignee !== "all") queryParams.set("assigneeId", filterAssignee);
  if (filterStatus !== "all") queryParams.set("status", filterStatus);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["calendar-events", filterProject, filterDepartment, filterAssignee, filterStatus],
    queryFn: () => apiClient.get(`/calendar/events?${queryParams.toString()}`).then(r => r.data),
    refetchInterval: 15000,
  });

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border bg-card overflow-x-auto scrollbar-hide">
        <CalendarDays className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        <span className="font-semibold flex-shrink-0">Calendar</span>

        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="h-8 text-xs w-[130px] flex-shrink-0"><SelectValue placeholder="All projects" /></SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">All projects</SelectItem>
              {(projects as Project[]).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterDepartment} onValueChange={setFilterDepartment}>
            <SelectTrigger className="h-8 text-xs w-[130px] flex-shrink-0"><SelectValue placeholder="All departments" /></SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">All departments</SelectItem>
              {(departments as Department[]).map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterAssignee} onValueChange={setFilterAssignee}>
            <SelectTrigger className="h-8 text-xs w-[120px] flex-shrink-0"><SelectValue placeholder="All assignees" /></SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">All assignees</SelectItem>
              {(users as UserProfileMini[]).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8 text-xs w-[110px] flex-shrink-0"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="all">All statuses</SelectItem>
              {TASK_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="flex items-center bg-muted rounded-lg p-0.5 flex-shrink-0">
            <Button variant={view === "month" ? "secondary" : "ghost"} size="sm" onClick={() => setView("month")} className="h-7 text-xs">Month</Button>
            <Button variant={view === "gantt" ? "secondary" : "ghost"} size="sm" onClick={() => setView("gantt")} className="h-7 text-xs">Gantt</Button>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(d => subMonths(d, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium w-24 text-center tabular-nums">{format(currentDate, "MMM yyyy")}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(d => addMonths(d, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCurrentDate(new Date())} className="h-8 text-xs">Today</Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : view === "month" ? (
        <MonthView days={days} currentDate={currentDate} events={events as CalendarEvent[]} />
      ) : (
        <GanttView events={events as CalendarEvent[]} />
      )}
    </div>
  );
}
