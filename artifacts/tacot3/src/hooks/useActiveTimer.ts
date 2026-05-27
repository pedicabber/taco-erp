import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import type { Task } from "@/lib/types";

export type RecentTimerEntry = {
  task: Task;
  lastStartedAt: string;
};

export type SwitchTimerResult = {
  stopped: Task | null;
  started: Task;
};

const ACTIVE_KEY = ["my-active-timer"] as const;
const RECENT_KEY = ["my-recent-timers"] as const;

export function useActiveTimer() {
  return useQuery<Task | null>({
    queryKey: ACTIVE_KEY,
    queryFn: () => apiClient.get("/tasks/me/active-timer").then((r) => r.data ?? null),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function useRecentTimers() {
  return useQuery<RecentTimerEntry[]>({
    queryKey: RECENT_KEY,
    queryFn: () => apiClient.get("/tasks/me/recent-timers?limit=5").then((r) => r.data),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

function invalidateTimerCaches(qc: ReturnType<typeof useQueryClient>, taskIds: number[]) {
  qc.invalidateQueries({ queryKey: ACTIVE_KEY });
  qc.invalidateQueries({ queryKey: RECENT_KEY });
  qc.invalidateQueries({ queryKey: ["tasks"] });
  for (const id of taskIds) {
    qc.invalidateQueries({ queryKey: ["task", id] });
  }
}

export function useSwitchTimer() {
  const qc = useQueryClient();
  return useMutation<SwitchTimerResult, Error, number>({
    mutationFn: (taskId) =>
      apiClient.post(`/tasks/${taskId}/timer/switch`).then((r) => r.data),
    onSuccess: (data) => {
      const ids = [data.started.id];
      if (data.stopped) ids.push(data.stopped.id);
      invalidateTimerCaches(qc, ids);
    },
  });
}

export function useStopActiveTimer() {
  const qc = useQueryClient();
  return useMutation<Task, Error, number>({
    mutationFn: (taskId) =>
      apiClient.post(`/tasks/${taskId}/timer/stop`).then((r) => r.data),
    onSuccess: (task) => {
      invalidateTimerCaches(qc, [task.id]);
    },
  });
}
