import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { Activity, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow, format } from "date-fns";
import { Link } from "wouter";
import type { ActivityItem } from "@/lib/types";

const PAGE_SIZE = 50;

function ActorAvatar({ item }: { item: ActivityItem }) {
  const av = (item as ActivityItem & { actorAvatarUrl?: string | null }).actorAvatarUrl;
  const initials = item.actorName?.[0]?.toUpperCase() ?? "?";

  if (av) {
    return (
      <img
        src={av}
        alt={item.actorName}
        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
        onError={e => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  return (
    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-xs font-semibold text-muted-foreground">
      {initials}
    </div>
  );
}

export default function ActivityPage() {
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  const { data: items = [], isLoading, isFetching } = useQuery<ActivityItem[]>({
    queryKey: ["activity-full", page],
    queryFn: () =>
      apiClient
        .get(`/activity?limit=${PAGE_SIZE}&offset=${offset}`)
        .then(r => r.data),
    placeholderData: prev => prev,
  });

  const { data: totalData } = useQuery<{ total: number }>({
    queryKey: ["activity-total"],
    queryFn: async () => {
      const r = await apiClient.get(`/activity?limit=1&offset=0`);
      const total = parseInt(r.headers["x-total-count"] ?? "0", 10);
      return { total };
    },
    staleTime: 60000,
  });

  const total = totalData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-6 py-4 border-b border-border bg-card">
        <Activity className="w-5 h-5 text-muted-foreground" />
        <h1 className="font-semibold text-lg">Activity Log</h1>
        {total > 0 && (
          <span className="text-sm text-muted-foreground">
            ({total.toLocaleString()} events)
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && page === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Activity className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">No activity recorded yet</p>
          </div>
        ) : (
          <div className={`max-w-3xl mx-auto px-4 py-4 transition-opacity duration-150 ${isFetching ? "opacity-50" : "opacity-100"}`}>
            {/* Pagination info row */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">
                {total > 0 ? `Showing ${start}–${end} of ${total.toLocaleString()}` : ""}
              </span>
              <PaginationControls page={page} totalPages={totalPages} setPage={setPage} />
            </div>

            {/* Timeline */}
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-3.5 top-0 bottom-0 w-px bg-border" />

              <div className="space-y-0">
                {items.map((item, idx) => {
                  const prev = items[idx - 1];
                  const thisDate = new Date(item.createdAt);
                  const prevDate = prev ? new Date(prev.createdAt) : null;
                  const showDateHeader =
                    !prevDate ||
                    format(thisDate, "yyyy-MM-dd") !== format(prevDate, "yyyy-MM-dd");

                  return (
                    <div key={item.id}>
                      {showDateHeader && (
                        <div className="relative flex items-center py-3 pl-10">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {format(thisDate, "EEEE, MMMM d, yyyy")}
                          </span>
                        </div>
                      )}
                      <div className="relative flex items-start gap-4 py-2.5 pl-10 group">
                        {/* Avatar pinned to the timeline */}
                        <div className="absolute left-0 top-2.5">
                          <ActorAvatar item={item} />
                        </div>

                        <div className="flex-1 min-w-0 bg-card rounded-lg border border-border px-3 py-2 group-hover:border-border/80 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm leading-snug">
                              <span className="font-semibold">{item.actorName}</span>{" "}
                              <span className="text-muted-foreground">{item.action}</span>
                            </p>
                            <span
                              className="text-xs text-muted-foreground flex-shrink-0 tabular-nums"
                              title={format(thisDate, "PPpp")}
                            >
                              {formatDistanceToNow(thisDate, { addSuffix: true })}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Link href={`/tasks/${item.taskId}`}>
                              <span className="text-xs text-primary hover:underline cursor-pointer font-medium">
                                {item.taskTitle}
                              </span>
                            </Link>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground">{item.projectName}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom pagination */}
            <div className="flex justify-center pt-6 pb-4">
              <PaginationControls page={page} totalPages={totalPages} setPage={setPage} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PaginationControls({
  page,
  totalPages,
  setPage,
}: {
  page: number;
  totalPages: number;
  setPage: (p: number) => void;
}) {
  const windowSize = 5;
  const half = Math.floor(windowSize / 2);
  let start = Math.max(0, page - half);
  const end = Math.min(totalPages - 1, start + windowSize - 1);
  start = Math.max(0, end - windowSize + 1);
  const pageNums = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={page === 0}
        onClick={() => { setPage(0); window.scrollTo(0, 0); }}
      >
        <ChevronLeft className="w-3 h-3" />
        <ChevronLeft className="w-3 h-3 -ml-2" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={page === 0}
        onClick={() => { setPage(Math.max(0, page - 1)); window.scrollTo(0, 0); }}
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>

      {start > 0 && (
        <>
          <Button variant="outline" size="sm" className="h-8 w-8 text-xs" onClick={() => setPage(0)}>1</Button>
          {start > 1 && <span className="text-xs text-muted-foreground px-1">…</span>}
        </>
      )}

      {pageNums.map(p => (
        <Button
          key={p}
          variant={p === page ? "default" : "outline"}
          size="sm"
          className="h-8 w-8 text-xs"
          onClick={() => { setPage(p); window.scrollTo(0, 0); }}
        >
          {p + 1}
        </Button>
      ))}

      {end < totalPages - 1 && (
        <>
          {end < totalPages - 2 && <span className="text-xs text-muted-foreground px-1">…</span>}
          <Button variant="outline" size="sm" className="h-8 w-8 text-xs" onClick={() => setPage(totalPages - 1)}>
            {totalPages}
          </Button>
        </>
      )}

      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={page >= totalPages - 1}
        onClick={() => { setPage(Math.min(totalPages - 1, page + 1)); window.scrollTo(0, 0); }}
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={page >= totalPages - 1}
        onClick={() => { setPage(totalPages - 1); window.scrollTo(0, 0); }}
      >
        <ChevronRight className="w-3 h-3" />
        <ChevronRight className="w-3 h-3 -ml-2" />
      </Button>
    </div>
  );
}
