import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Timer, Play, Square, ArrowRight, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/apiClient";
import { useLiveTimer } from "@/hooks/useLiveTimer";
import {
  useActiveTimer,
  useRecentTimers,
  useSwitchTimer,
  useStopActiveTimer,
} from "@/hooks/useActiveTimer";
import type { Project, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ActiveTimerDisplay({ task }: { task: Task }) {
  const live = useLiveTimer(task.elapsedSeconds, task.timerRunning, task.timerStartedAt);
  return <span className="font-mono tabular-nums">{formatElapsed(live)}</span>;
}

function StartDifferentSection({ onSwitched }: { onSwitched: () => void }) {
  const { toast } = useToast();
  const switchTimer = useSwitchTimer();
  const [projectId, setProjectId] = useState<string>("");
  const [taskId, setTaskId] = useState<string>("");

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then((r) => r.data),
  });

  const { data: projectTasks = [], isFetching: tasksFetching } = useQuery<Task[]>({
    queryKey: ["tasks", projectId],
    queryFn: () => apiClient.get(`/tasks?projectId=${projectId}`).then((r) => r.data),
    enabled: !!projectId,
  });

  const handleStart = async () => {
    if (!taskId) return;
    try {
      const result = await switchTimer.mutateAsync(Number(taskId));
      const startedTitle = result.started.title;
      if (result.stopped) {
        toast({
          title: "Switched timer",
          description: `Stopped “${result.stopped.title}” · Started “${startedTitle}”`,
        });
      } else {
        toast({ title: "Started timer", description: `“${startedTitle}”` });
      }
      setProjectId("");
      setTaskId("");
      onSwitched();
    } catch (e) {
      toast({
        title: "Could not start timer",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-2">
      <Select value={projectId} onValueChange={(v) => { setProjectId(v); setTaskId(""); }}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder="Select project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>{p.company} — {p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={taskId} onValueChange={setTaskId} disabled={!projectId}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder={projectId ? (tasksFetching ? "Loading…" : "Select task") : "Pick a project first"} />
        </SelectTrigger>
        <SelectContent>
          {projectTasks
            .filter((t) => t.status !== "complete")
            .map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>{t.title}</SelectItem>
            ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        className="w-full"
        onClick={handleStart}
        disabled={!taskId || switchTimer.isPending}
      >
        {switchTimer.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
        Start Timer
      </Button>
    </div>
  );
}

export default function TimeclockPopover() {
  const [open, setOpen] = useState(false);
  const [showStartDifferent, setShowStartDifferent] = useState(false);
  const { toast } = useToast();
  const { data: active } = useActiveTimer();
  const { data: recent = [] } = useRecentTimers();
  const switchTimer = useSwitchTimer();
  const stopActive = useStopActiveTimer();

  const isRunning = !!active;

  const recentFiltered = useMemo(
    () => recent.filter((r) => !active || r.task.id !== active.id).slice(0, 5),
    [recent, active],
  );

  const handleStop = async () => {
    if (!active) return;
    try {
      await stopActive.mutateAsync(active.id);
      toast({ title: "Stopped timer", description: `“${active.title}”` });
    } catch (e) {
      toast({
        title: "Could not stop timer",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleQuickStart = async (taskId: number, title: string) => {
    try {
      const result = await switchTimer.mutateAsync(taskId);
      if (result.stopped) {
        toast({
          title: "Switched timer",
          description: `Stopped “${result.stopped.title}” · Started “${title}”`,
        });
      } else {
        toast({ title: "Started timer", description: `“${title}”` });
      }
    } catch (e) {
      toast({
        title: "Could not start timer",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex items-center justify-center w-9 h-9 rounded-lg hover:bg-muted transition-colors cursor-pointer"
          title={isRunning ? `Timer running: ${active!.title}` : "Time clock"}
          aria-label="Open time clock"
        >
          <Timer className={cn("w-5 h-5", isRunning && "text-primary")} />
          {isRunning && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0" sideOffset={8}>
        {/* Current task */}
        <div className="p-3 border-b">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Current Task
          </div>
          {active ? (
            <div className="space-y-2">
              <div>
                <div className="font-medium text-sm leading-snug line-clamp-2">{active.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <ActiveTimerDisplay task={active} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  onClick={handleStop}
                  disabled={stopActive.isPending}
                >
                  {stopActive.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Square className="w-4 h-4 mr-1.5" />}
                  Stop
                </Button>
                <Link href={`/tasks/${active.id}`} onClick={() => setOpen(false)} className="flex-1">
                  <Button size="sm" variant="outline" className="w-full">
                    Go to task
                    <ArrowRight className="w-4 h-4 ml-1.5" />
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No timer running.</div>
          )}
        </div>

        {/* Recently worked */}
        <div className="p-3 border-b">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Recently Worked
          </div>
          {recentFiltered.length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">No recent timers.</div>
          ) : (
            <ul className="space-y-1.5">
              {recentFiltered.map((r) => (
                <li
                  key={r.task.id}
                  className="flex items-center gap-2 rounded-md hover:bg-muted/60 px-2 py-1.5 -mx-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{r.task.title}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {r.task.projectId != null ? `Project #${r.task.projectId}` : "No project"}
                      {" · "}
                      {formatRelative(r.lastStartedAt)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleQuickStart(r.task.id, r.task.title)}
                    disabled={switchTimer.isPending}
                  >
                    <Play className="w-3.5 h-3.5 mr-1" />
                    Start
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Start different task */}
        <div className="p-3">
          <button
            type="button"
            className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowStartDifferent((v) => !v)}
          >
            <span>Start Different Task</span>
            {showStartDifferent ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showStartDifferent && (
            <div className="mt-2">
              <StartDifferentSection onSwitched={() => setShowStartDifferent(false)} />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
