import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  FolderKanban, CheckSquare, Clock, AlertTriangle, Activity,
  ShieldCheck, Star, Truck, DollarSign, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Project, ActivityItem } from "@/lib/types";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

// ── Shared stat card ──────────────────────────────────────────────────────────
function StatCard({
  icon: Icon, label, value, sub, color, delay = 0,
}: {
  icon: React.ElementType; label: string; value: number | string; sub?: string;
  color: string; delay?: number;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3 }}>
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground font-medium">{label}</p>
              <p className="text-3xl font-bold mt-1">{value}</p>
              {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
            </div>
            <div className={`p-2.5 rounded-lg ${color}`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── SQDC Types ────────────────────────────────────────────────────────────────
type SqdcStatus = "green" | "yellow" | "red" | "neutral";
type SqdcBadgeTone = "ok" | "warn" | "bad" | "neutral";

interface SqdcRecord {
  id: string;
  kind: "task" | "project";
  title: string;
  subtitle: string;
  href: string;
  badge: string;
  badgeTone: SqdcBadgeTone;
  occurredAt: string | null;
}
interface SqdcMetric {
  key: "S" | "Q" | "D" | "C";
  fullName: string;
  icon: React.ElementType;
  score: number | null;
  scoreLabel: string;
  status: SqdcStatus;
  statusLabel: string;
  calendarData: number[];
  keyMetrics: { label: string; value: string }[];
  trendData: { month: string; value: number }[];
  records: SqdcRecord[];
  trendType: "bar" | "line";
  trendUnit?: string;
}

interface SqdcApiCategory extends Omit<SqdcMetric, "fullName" | "icon"> {}

const SQDC_META: Record<"S" | "Q" | "D" | "C", { fullName: string; icon: React.ElementType }> = {
  S: { fullName: "Safety", icon: ShieldCheck },
  Q: { fullName: "Quality", icon: Star },
  D: { fullName: "Delivery", icon: Truck },
  C: { fullName: "Cost", icon: DollarSign },
};

const COL = {
  S: {
    accent: "#16a34a",
    headerBg: "bg-green-950/80 border-green-800/60",
    letterBg: "bg-green-700",
    metricBg: "bg-green-900/50 border-green-700/40 text-green-300",
    chartColor: "#22c55e",
    dotColor: "bg-green-400",
    statusText: "text-green-400",
    snippetBg: "bg-green-950/90 border-green-700/50",
  },
  Q: {
    accent: "#ca8a04",
    headerBg: "bg-yellow-950/80 border-yellow-800/60",
    letterBg: "bg-yellow-600",
    metricBg: "bg-yellow-900/50 border-yellow-700/40 text-yellow-300",
    chartColor: "#eab308",
    dotColor: "bg-yellow-400",
    statusText: "text-yellow-400",
    snippetBg: "bg-yellow-950/90 border-yellow-700/50",
  },
  D: {
    accent: "#7c3aed",
    headerBg: "bg-purple-950/80 border-purple-800/60",
    letterBg: "bg-purple-700",
    metricBg: "bg-purple-900/50 border-purple-700/40 text-purple-300",
    chartColor: "#a855f7",
    dotColor: "bg-purple-400",
    statusText: "text-purple-400",
    snippetBg: "bg-purple-950/90 border-purple-700/50",
  },
  C: {
    accent: "#ea580c",
    headerBg: "bg-orange-950/80 border-orange-800/60",
    letterBg: "bg-orange-700",
    metricBg: "bg-orange-900/50 border-orange-700/40 text-orange-300",
    chartColor: "#f97316",
    dotColor: "bg-orange-400",
    statusText: "text-orange-400",
    snippetBg: "bg-orange-950/90 border-orange-700/50",
  },
} as const;

// Neutral palette used when a category has no underlying data.
const COL_NEUTRAL = {
  accent: "#6b7280",
  headerBg: "bg-zinc-900/80 border-zinc-700/60",
  letterBg: "bg-zinc-700",
  metricBg: "bg-zinc-800/50 border-zinc-700/40 text-zinc-300",
  chartColor: "#71717a",
  dotColor: "bg-zinc-400",
  statusText: "text-zinc-400",
  snippetBg: "bg-zinc-900/90 border-zinc-700/50",
} as const;

function colorsFor(m: SqdcMetric): typeof COL[keyof typeof COL] {
  return m.status === "neutral" ? COL_NEUTRAL : COL[m.key];
}

const BADGE_TONE_STYLE: Record<SqdcBadgeTone, string> = {
  ok: "bg-green-900/70 text-green-300",
  warn: "bg-yellow-900/70 text-yellow-300",
  bad: "bg-red-900/70 text-red-300",
  neutral: "bg-zinc-800/70 text-zinc-300",
};

const CAL_CELL_BG = ["bg-green-700/60", "bg-yellow-600/70", "bg-red-700/70"] as const;

// ── Calendar mini-grid ─────────────────────────────────────────────────────────
function SqdcCalendar({ data, size = "sm" }: { data: number[]; size?: "sm" | "lg" }) {
  const cell = size === "lg" ? "w-7 h-7 rounded text-[10px]" : "w-5 h-5 rounded-sm text-[9px]";
  return (
    <div className="flex gap-0.5 justify-center">
      {Array.from({ length: 7 }, (_, col) => (
        <div key={col} className="flex flex-col gap-0.5">
          {Array.from({ length: 5 }, (_, row) => {
            const idx = row * 7 + col;
            const val = data[idx] ?? -1;
            return (
              <div
                key={row}
                className={cn(
                  cell,
                  "flex items-center justify-center text-white/80 font-medium",
                  val === -1 ? "bg-white/5" : CAL_CELL_BG[val as 0 | 1 | 2],
                )}
              >
                {val !== -1 ? idx + 1 : ""}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── SQDC tile (clickable header card) ─────────────────────────────────────────
function SqdcHeaderTile({
  m, colors, onClick, isExpanded,
}: {
  m: SqdcMetric;
  colors: typeof COL[keyof typeof COL];
  onClick: () => void;
  isExpanded: boolean;
}) {
  const noData = m.status === "neutral";
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full h-full rounded-xl border p-4 text-left transition-all hover:brightness-110 active:scale-[0.99]",
        colors.headerBg,
        isExpanded && "ring-2 ring-white/20",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(colors.letterBg, "rounded-lg w-12 h-12 flex items-center justify-center flex-shrink-0")}>
          <span className="text-3xl font-black text-white leading-none">{m.key}</span>
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold truncate">{m.fullName}</p>
          <p className="text-2xl sm:text-3xl lg:text-4xl font-black leading-none mt-0.5 text-white truncate">{m.scoreLabel}</p>
          <p className="text-[10px] uppercase text-white/40 mt-0.5 tracking-wider">
            {noData ? "No data available" : "SCORE"}
          </p>
        </div>
      </div>
      <p className="text-[9px] text-white/30 mt-3 uppercase tracking-widest flex items-center gap-0.5">
        {isExpanded ? "Tap to close" : "Click for details"}
        <ChevronRight className={cn("w-2.5 h-2.5 inline transition-transform", isExpanded && "rotate-90")} />
      </p>
    </button>
  );
}

function EmptyPanelMessage() {
  return (
    <div className="h-full min-h-[64px] flex items-center justify-center text-[11px] text-white/40">
      No data available
    </div>
  );
}

// ── Snippet panel (drops below tiles on click) ─────────────────────────────────
function SqdcSnippetPanel({
  m, colors,
}: {
  m: SqdcMetric;
  colors: typeof COL[keyof typeof COL];
}) {
  const fmt = (v: number) => {
    if (m.trendUnit) return `${v}${m.trendUnit}`;
    // Cost trend ships hours; every other unit-less category ships counts.
    return m.key === "C" ? `${v}h` : v.toString();
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: "easeInOut" }}
      className="overflow-hidden col-span-full"
    >
      <div className={cn("rounded-xl border p-4 mt-1", colors.snippetBg)}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Calendar */}
          <div className="bg-black/25 rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">Status Calendar</p>
            {m.calendarData.some(v => v > 0) ? (
              <SqdcCalendar data={m.calendarData} />
            ) : (
              <EmptyPanelMessage />
            )}
          </div>
          {/* Key Metrics */}
          <div className="bg-black/25 rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">Key Metrics</p>
            <div className="flex flex-col gap-2">
              {m.keyMetrics.map((km, i) => (
                <div key={i} className={cn("rounded-lg px-3 py-2 border", colors.metricBg)}>
                  <p className="text-xl font-black leading-none">{km.value}</p>
                  <p className="text-[10px] mt-0.5 opacity-80">{km.label}</p>
                </div>
              ))}
            </div>
          </div>
          {/* 6-Month Trend */}
          <div className="bg-black/25 rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">6-Month Trend</p>
            <div className="h-24">
              {m.trendData.length === 0 ? (
                <EmptyPanelMessage />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  {m.trendType === "bar" ? (
                    <BarChart data={m.trendData} barSize={8}>
                      <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#888" }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 10 }}
                        formatter={(v: number) => [fmt(v), m.fullName]}
                      />
                      <Bar dataKey="value" fill={colors.chartColor} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  ) : (
                    <LineChart data={m.trendData}>
                      <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#888" }} axisLine={false} tickLine={false} />
                      <YAxis hide domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 10 }}
                        formatter={(v: number) => [fmt(v), m.fullName]}
                      />
                      <Line type="monotone" dataKey="value" stroke={colors.chartColor} strokeWidth={2} dot={{ r: 3, fill: colors.chartColor }} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              )}
            </div>
          </div>
          {/* Records */}
          <div className="bg-black/25 rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">Records</p>
            {m.records.length === 0 ? (
              <EmptyPanelMessage />
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_auto] gap-2 text-[9px] uppercase tracking-widest text-white/40 font-bold pb-1.5 border-b border-white/10">
                  <span>Item</span><span>Status</span>
                </div>
                {m.records.slice(0, 6).map((r) => (
                  <Link key={r.id} href={r.href}>
                    <div className="grid grid-cols-[1fr_auto] gap-2 items-center py-0.5 hover:bg-white/5 rounded px-1 -mx-1 cursor-pointer">
                      <div className="min-w-0">
                        <p className="text-[10px] truncate text-white/80">{r.title}</p>
                        <p className="text-[9px] truncate text-white/40">
                          {r.subtitle}
                          {r.occurredAt && ` · ${formatDistanceToNow(new Date(r.occurredAt), { addSuffix: true })}`}
                        </p>
                      </div>
                      <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap", BADGE_TONE_STYLE[r.badgeTone])}>
                        {r.badge}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── SQDC Dashboard (admin) ────────────────────────────────────────────────────
function SqdcDashboard() {
  const [expanded, setExpanded] = useState<"S" | "Q" | "D" | "C" | null>(null);

  const { data: summary } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => apiClient.get("/dashboard/summary").then(r => r.data),
    refetchInterval: 60000,
  });
  const { data: activity } = useQuery({
    queryKey: ["activity-feed"],
    queryFn: () => apiClient.get("/activity?limit=10").then(r => r.data),
  });
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });
  const { data: sqdcData } = useQuery<{ categories: SqdcApiCategory[] }>({
    queryKey: ["dashboard-sqdc"],
    queryFn: () => apiClient.get("/dashboard/sqdc").then(r => r.data),
    refetchInterval: 60000,
  });
  const recentProjects = (projects as Project[] | undefined)?.slice(0, 5) ?? [];

  // Build the SQDC display array by merging API data with the static
  // per-key metadata (fullName, icon). Falls back to neutral placeholders
  // while the query is in flight so the layout never shifts.
  const sqdcMetrics: SqdcMetric[] = (["S", "Q", "D", "C"] as const).map(key => {
    const api = sqdcData?.categories.find(c => c.key === key);
    const meta = SQDC_META[key];
    if (api) return { ...api, fullName: meta.fullName, icon: meta.icon };
    return {
      key,
      fullName: meta.fullName,
      icon: meta.icon,
      score: null,
      scoreLabel: "—",
      status: "neutral" as SqdcStatus,
      statusLabel: "NO DATA",
      keyMetrics: [],
      calendarData: new Array(35).fill(0),
      trendData: [],
      records: [],
      trendType: "bar" as const,
    };
  });
  const allNeutral = sqdcMetrics.every(m => m.status === "neutral");

  const overallStatus: SqdcStatus = sqdcMetrics.some(m => m.status === "red") ? "red"
    : sqdcMetrics.some(m => m.status === "yellow") ? "yellow"
    : sqdcMetrics.some(m => m.status === "green") ? "green" : "neutral";
  const overallLabel = {
    green: "ON TARGET", yellow: "AT RISK", red: "OFF TARGET", neutral: "NO DATA",
  }[overallStatus];
  const overallBadge = {
    green: "bg-green-900/50 text-green-300 border-green-700",
    yellow: "bg-yellow-900/40 text-yellow-300 border-yellow-700",
    red: "bg-red-900/40 text-red-300 border-red-700",
    neutral: "bg-zinc-800/60 text-zinc-300 border-zinc-700",
  }[overallStatus];

  function toggle(key: "S" | "Q" | "D" | "C") {
    setExpanded(prev => prev === key ? null : key);
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">SQDC Performance Board</h1>
        <span className={cn("text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded border", overallBadge)}>
          {overallLabel}
        </span>
        <span className="text-sm text-muted-foreground ml-auto hidden sm:block">
          {new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date())}
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
      >
        {/* ── SQDC Tiles ───────────────────────────────────────────────── */}
        {allNeutral && (
          <p className="text-xs text-muted-foreground mb-3">
            Tag tasks with Safety / Quality / Delivery results to start populating this board.
          </p>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {sqdcMetrics.map((m, i) => (
            <motion.div
              key={m.key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, duration: 0.3 }}
              className={cn(
                // Mobile: hide non-selected tiles when one is expanded
                expanded && expanded !== m.key && "hidden lg:block",
                // Mobile: selected tile spans full width (2 of 2 cols)
                expanded === m.key && "col-span-2 lg:col-span-1",
              )}
            >
              <SqdcHeaderTile
                m={m}
                colors={colorsFor(m)}
                onClick={() => toggle(m.key)}
                isExpanded={expanded === m.key}
              />
            </motion.div>
          ))}

          {/* Snippet panel — col-span-full so it appears below all tiles */}
          <AnimatePresence>
            {expanded && (() => {
              const m = sqdcMetrics.find(x => x.key === expanded)!;
              return <SqdcSnippetPanel key={expanded} m={m} colors={colorsFor(m)} />;
            })()}
          </AnimatePresence>
        </div>

            {/* ── Regular Dashboard Content ──────────────────────────────── */}
            <div className="border-t border-border/50 pt-6">
              {/* Stat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatCard icon={FolderKanban} label="Active Projects" value={summary?.activeProjects ?? "—"} sub={`${summary?.totalProjects ?? 0} total`} color="bg-blue-500" delay={0} />
                <StatCard icon={CheckSquare} label="Tasks" value={summary?.totalTasks ?? "—"} sub={`${summary?.tasksCompleted ?? 0} completed`} color="bg-green-500" delay={0.05} />
                <StatCard icon={Clock} label="In Progress" value={summary?.tasksInProgress ?? "—"} sub="tasks active" color="bg-orange-500" delay={0.1} />
                <StatCard icon={AlertTriangle} label="Overdue" value={summary?.overdueTasks ?? "—"} sub={`${summary?.myOverdueTasks ?? 0} mine`} color="bg-red-500" delay={0.15} />
              </div>

              {/* Projects + Activity */}
              <div className="grid md:grid-cols-2 gap-6">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="min-w-0">
                  <Card className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <FolderKanban className="w-4 h-4" />
                          Recent Projects
                        </CardTitle>
                        <Link href="/projects">
                          <span className="text-sm text-primary hover:underline cursor-pointer">View all</span>
                        </Link>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {recentProjects.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">No projects yet</p>
                      ) : (
                        <div className="space-y-3">
                          {recentProjects.map((project: Project) => (
                            <Link key={project.id} href={`/projects/${project.id}`} className="block">
                              <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors min-w-0 overflow-hidden">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{project.name}</p>
                                  <p className="text-xs text-muted-foreground truncate">{project.company}</p>
                                </div>
                                <Badge variant={project.status === "active" ? "default" : "secondary"} className="ml-2 flex-shrink-0 capitalize whitespace-nowrap">
                                  {project.status.replace("_", " ")}
                                </Badge>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="min-w-0">
                  <Card className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Activity className="w-4 h-4" />
                          Recent Activity
                        </CardTitle>
                        <Link href="/activity">
                          <span className="text-sm text-primary hover:underline cursor-pointer">View all</span>
                        </Link>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {!activity || (activity as ActivityItem[]).length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">No activity yet</p>
                      ) : (
                        <div className="space-y-3">
                          {(activity as ActivityItem[]).map((log: ActivityItem) => (
                            <div key={log.id} className="flex items-start gap-3">
                              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-xs font-medium">
                                {log.actorName?.[0]?.toUpperCase() ?? "?"}
                              </div>
                              <div className="min-w-0 overflow-hidden">
                                <p className="text-sm truncate">
                                  <span className="font-medium">{log.actorName}</span>{" "}
                                  <span className="text-muted-foreground">{log.action}</span>
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {log.taskTitle} · {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
              </motion.div>
            </div>
          </div>
      </motion.div>
    </div>
  );
}

// ── Regular Dashboard (non-admin) ─────────────────────────────────────────────
function RegularDashboard({ currentUser }: { currentUser: { name?: string } | undefined }) {
  const { data: summary } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => apiClient.get("/dashboard/summary").then(r => r.data),
    refetchInterval: 60000,
  });
  const { data: activity } = useQuery({
    queryKey: ["activity-feed"],
    queryFn: () => apiClient.get("/activity?limit=10").then(r => r.data),
  });
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });
  const recentProjects = (projects as Project[] | undefined)?.slice(0, 5) ?? [];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto overflow-x-hidden">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, <span className="text-foreground font-medium">{currentUser?.name ?? "..."}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={FolderKanban} label="Active Projects" value={summary?.activeProjects ?? "—"} sub={`${summary?.totalProjects ?? 0} total`} color="bg-blue-500" delay={0} />
        <StatCard icon={CheckSquare} label="Tasks" value={summary?.totalTasks ?? "—"} sub={`${summary?.tasksCompleted ?? 0} completed`} color="bg-green-500" delay={0.05} />
        <StatCard icon={Clock} label="In Progress" value={summary?.tasksInProgress ?? "—"} sub="tasks active" color="bg-orange-500" delay={0.1} />
        <StatCard icon={AlertTriangle} label="Overdue" value={summary?.overdueTasks ?? "—"} sub={`${summary?.myOverdueTasks ?? 0} mine`} color="bg-red-500" delay={0.15} />
      </div>

      <div className="grid md:grid-cols-2 gap-6 overflow-hidden">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="min-w-0">
          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FolderKanban className="w-4 h-4" />
                  Recent Projects
                </CardTitle>
                <Link href="/projects">
                  <span className="text-sm text-primary hover:underline cursor-pointer">View all</span>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {recentProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No projects yet</p>
              ) : (
                <div className="space-y-3">
                  {recentProjects.map((project: Project) => (
                    <Link key={project.id} href={`/projects/${project.id}`} className="block">
                      <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors min-w-0 overflow-hidden">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{project.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{project.company}</p>
                        </div>
                        <Badge variant={project.status === "active" ? "default" : "secondary"} className="ml-2 flex-shrink-0 capitalize whitespace-nowrap">
                          {project.status.replace("_", " ")}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="min-w-0">
          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Recent Activity
                </CardTitle>
                <Link href="/activity">
                  <span className="text-sm text-primary hover:underline cursor-pointer">View all</span>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {!activity || (activity as ActivityItem[]).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {(activity as ActivityItem[]).map((log: ActivityItem) => (
                    <div key={log.id} className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-xs font-medium">
                        {log.actorName?.[0]?.toUpperCase() ?? "?"}
                      </div>
                      <div className="min-w-0 overflow-hidden">
                        <p className="text-sm truncate">
                          <span className="font-medium">{log.actorName}</span>{" "}
                          <span className="text-muted-foreground">{log.action}</span>
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {log.taskTitle} · {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: currentUser } = useCurrentUser();

  if (currentUser?.role === "admin") {
    return <SqdcDashboard />;
  }

  return <RegularDashboard currentUser={currentUser} />;
}
