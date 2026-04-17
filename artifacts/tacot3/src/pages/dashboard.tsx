import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { FolderKanban, CheckSquare, Clock, AlertTriangle, Activity, ShieldCheck, Star, Truck, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import type { Project, ActivityItem } from "@/lib/types";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

// ── Shared stat card ─────────────────────────────────────────────────────────
function StatCard({
  icon: Icon, label, value, sub, color, delay = 0,
}: {
  icon: React.ElementType; label: string; value: number | string; sub?: string;
  color: string; delay?: number;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3 }}>
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-5">
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

// ── SQDC Types & Mock Data ────────────────────────────────────────────────────
interface SqdcMetric {
  key: "S" | "Q" | "D" | "C";
  label: string;
  fullName: string;
  icon: React.ElementType;
  score: number;
  scoreLabel: string;
  status: "green" | "yellow" | "red";
  statusLabel: string;
  calendarData: number[]; // 0=green, 1=yellow, 2=red for 35 days
  keyMetrics: { label: string; value: string; color: string }[];
  trendData: { month: string; value: number }[];
  actionPlan: { action: string; due: string; status: "closed" | "in-progress" | "open" }[];
  trendType: "bar" | "line";
  trendUnit?: string;
}

const MONTHS_TREND = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];

const SQDC_METRICS: SqdcMetric[] = [
  {
    key: "S",
    label: "S",
    fullName: "Safety",
    icon: ShieldCheck,
    score: 100,
    scoreLabel: "100%",
    status: "green",
    statusLabel: "GREEN",
    calendarData: Array(35).fill(0).map((_, i) => (i === 12 ? 1 : 0)),
    keyMetrics: [
      { label: "Days W/O Incident", value: "90", color: "bg-green-500/20 text-green-400 border border-green-500/30" },
      { label: "Incidents / Mo", value: "0", color: "bg-green-500/20 text-green-400 border border-green-500/30" },
    ],
    trendData: MONTHS_TREND.map((month, i) => ({ month, value: [0, 0, 1, 0, 2, 0][i] })),
    actionPlan: [
      { action: "Design PLC...", due: "Feb 9", status: "closed" },
      { action: "HMI scree...", due: "Mar 31", status: "open" },
    ],
    trendType: "bar",
  },
  {
    key: "Q",
    label: "Q",
    fullName: "Quality",
    icon: Star,
    score: 80,
    scoreLabel: "80%",
    status: "yellow",
    statusLabel: "YELLOW",
    calendarData: Array(35).fill(0).map((_, i) => ([5, 11, 14, 22, 27].includes(i) ? 1 : [8, 19].includes(i) ? 2 : 0)),
    keyMetrics: [
      { label: "OFT Rate", value: "80%", color: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" },
      { label: "In Review", value: "1", color: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" },
    ],
    trendData: MONTHS_TREND.map((month, i) => ({ month, value: [75, 82, 78, 85, 80, 80][i] })),
    actionPlan: [
      { action: "Order ca...", due: "Feb 28", status: "in-progress" },
    ],
    trendType: "line",
    trendUnit: "%",
  },
  {
    key: "D",
    label: "D",
    fullName: "Delivery",
    icon: Truck,
    score: 100,
    scoreLabel: "100%",
    status: "green",
    statusLabel: "GREEN",
    calendarData: Array(35).fill(0).map((_, i) => ([15, 16, 17].includes(i) ? 1 : 0)),
    keyMetrics: [
      { label: "On-Time", value: "100%", color: "bg-purple-500/20 text-purple-400 border border-purple-500/30" },
      { label: "At Risk", value: "0", color: "bg-purple-500/20 text-purple-400 border border-purple-500/30" },
    ],
    trendData: MONTHS_TREND.map((month, i) => ({ month, value: [88, 92, 100, 95, 100, 100][i] })),
    actionPlan: [
      { action: "Electrical p...", due: "Apr 14", status: "open" },
    ],
    trendType: "line",
    trendUnit: "%",
  },
  {
    key: "C",
    label: "C",
    fullName: "Cost",
    icon: DollarSign,
    score: 6,
    scoreLabel: "6%",
    status: "red",
    statusLabel: "RED",
    calendarData: Array(35).fill(0).map((_, i) => ([3, 9, 14, 20, 26, 30].includes(i) ? 2 : [6, 17].includes(i) ? 1 : 0)),
    keyMetrics: [
      { label: "Variance", value: "-79%", color: "bg-red-500/20 text-red-400 border border-red-500/30" },
      { label: "Pending", value: "$387k", color: "bg-red-500/20 text-red-400 border border-red-500/30" },
    ],
    trendData: MONTHS_TREND.map((month, i) => ({ month, value: [180000, 220000, 310000, 260000, 350000, 387000][i] })),
    actionPlan: [
      { action: "Site surv...", due: "Mar 19", status: "in-progress" },
    ],
    trendType: "bar",
  },
];

const STATUS_COLORS = {
  green: { bg: "bg-green-600", text: "text-green-400", dot: "bg-green-400", tile: "bg-green-900/30 border-green-700/50" },
  yellow: { bg: "bg-yellow-600", text: "text-yellow-400", dot: "bg-yellow-400", tile: "bg-yellow-900/20 border-yellow-700/40" },
  red: { bg: "bg-red-700", text: "text-red-400", dot: "bg-red-400", tile: "bg-red-900/20 border-red-700/40" },
};

const KEY_COLORS = {
  S: { letter: "bg-green-700 text-white", chart: "#22c55e" },
  Q: { letter: "bg-yellow-600 text-white", chart: "#eab308" },
  D: { letter: "bg-purple-700 text-white", chart: "#a855f7" },
  C: { letter: "bg-orange-700 text-white", chart: "#f97316" },
};

const CAL_CELL = {
  0: "bg-green-700/60",
  1: "bg-yellow-600/60",
  2: "bg-red-700/60",
};

function StatusCalendar({ data }: { data: number[] }) {
  const days = Array.from({ length: 7 }, (_, col) =>
    Array.from({ length: 5 }, (_, row) => {
      const idx = row * 7 + col;
      return data[idx] ?? -1;
    })
  );
  return (
    <div className="flex gap-0.5">
      {days.map((col, ci) => (
        <div key={ci} className="flex flex-col gap-0.5">
          {col.map((v, ri) => (
            <div
              key={ri}
              className={`w-5 h-5 rounded-sm text-[9px] flex items-center justify-center text-white/70 font-medium ${
                v === -1 ? "bg-muted/30" : CAL_CELL[v as 0 | 1 | 2]
              }`}
            >
              {v !== -1 ? ri * 7 + ci + 1 : ""}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ActionStatus({ status }: { status: "closed" | "in-progress" | "open" }) {
  const map = {
    closed: "bg-green-800 text-green-300",
    "in-progress": "bg-blue-800 text-blue-300",
    open: "bg-orange-800 text-orange-300",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium capitalize ${map[status]}`}>
      {status === "in-progress" ? "in progress" : status}
    </span>
  );
}

function SqdcColumn({ metric }: { metric: SqdcMetric }) {
  const sc = STATUS_COLORS[metric.status];
  const kc = KEY_COLORS[metric.key];
  const fmt = (v: number) =>
    metric.trendUnit === "%" ? `${v}%` : v >= 1000 ? `$${Math.round(v / 1000)}k` : v.toString();

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Score tile */}
      <div className={`rounded-lg border p-4 ${sc.tile}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl font-black flex-shrink-0 ${kc.letter}`}>
            {metric.key}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{metric.fullName}</p>
            <p className="text-3xl font-black leading-none mt-0.5">{metric.scoreLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <div className={`w-2 h-2 rounded-full ${sc.dot}`} />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${sc.text}`}>{metric.statusLabel}</span>
        </div>
        <p className="text-[9px] text-muted-foreground mt-1 uppercase tracking-wider">Click for details</p>
      </div>

      {/* Status Calendar */}
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Status Calendar</p>
        <StatusCalendar data={metric.calendarData} />
      </div>

      {/* Key Metrics */}
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Key Metrics</p>
        <div className="flex gap-2">
          {metric.keyMetrics.map((km, i) => (
            <div key={i} className={`flex-1 rounded-md px-2 py-2 ${km.color}`}>
              <p className="text-lg font-black leading-none">{km.value}</p>
              <p className="text-[9px] text-current/70 mt-0.5 leading-tight">{km.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 6-Month Trend */}
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">6-Month Trend</p>
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            {metric.trendType === "bar" ? (
              <BarChart data={metric.trendData} barSize={10}>
                <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#888" }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 10 }}
                  formatter={(v: number) => [fmt(v), metric.fullName]}
                />
                <Bar dataKey="value" fill={kc.chart} radius={[2, 2, 0, 0]} />
              </BarChart>
            ) : (
              <LineChart data={metric.trendData}>
                <XAxis dataKey="month" tick={{ fontSize: 8, fill: "#888" }} axisLine={false} tickLine={false} />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 10 }}
                  formatter={(v: number) => [fmt(v), metric.fullName]}
                />
                <Line type="monotone" dataKey="value" stroke={kc.chart} strokeWidth={2} dot={{ r: 3, fill: kc.chart }} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Action Plan */}
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Action Plan</p>
        <div className="space-y-1.5">
          <div className="grid grid-cols-3 gap-1 text-[9px] text-muted-foreground font-medium uppercase tracking-wider pb-1 border-b border-border">
            <span>Action</span><span>Due</span><span>Status</span>
          </div>
          {metric.actionPlan.map((ap, i) => (
            <div key={i} className="grid grid-cols-3 gap-1 items-center">
              <span className="text-[10px] truncate text-foreground">{ap.action}</span>
              <span className="text-[10px] text-muted-foreground">{ap.due}</span>
              <ActionStatus status={ap.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── SQDC Dashboard (admin) ─────────────────────────────────────────────────────
function SqdcDashboard() {
  const overallStatus: "green" | "yellow" | "red" = SQDC_METRICS.some(m => m.status === "red")
    ? "red"
    : SQDC_METRICS.some(m => m.status === "yellow")
    ? "yellow"
    : "green";

  const statusMap = { green: "ON TARGET", yellow: "AT RISK", red: "OFF TARGET" };
  const statusBadge = {
    green: "bg-green-900/50 text-green-300 border-green-700",
    yellow: "bg-yellow-900/40 text-yellow-300 border-yellow-700",
    red: "bg-red-900/40 text-red-300 border-red-700",
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">SQDC Performance Board</h1>
          <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded border ${statusBadge[overallStatus]}`}>
            {statusMap[overallStatus]}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date())}
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {SQDC_METRICS.map((metric, i) => (
          <motion.div
            key={metric.key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
          >
            <SqdcColumn metric={metric} />
          </motion.div>
        ))}
      </div>
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

  const recentProjects = projects?.slice(0, 5) ?? [];

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
              {!activity || activity.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {activity.map((log: ActivityItem) => (
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
  const isAdmin = currentUser?.role === "admin";

  if (isAdmin) return <SqdcDashboard />;
  return <RegularDashboard currentUser={currentUser} />;
}
