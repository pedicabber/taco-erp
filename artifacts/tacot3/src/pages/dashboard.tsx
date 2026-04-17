import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  FolderKanban, CheckSquare, Clock, AlertTriangle, Activity,
  ShieldCheck, Star, Truck, DollarSign, ChevronRight, ArrowLeft,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

// ── SQDC Types & Data ─────────────────────────────────────────────────────────
interface SqdcMetric {
  key: "S" | "Q" | "D" | "C";
  fullName: string;
  icon: React.ElementType;
  score: number;
  scoreLabel: string;
  status: "green" | "yellow" | "red";
  statusLabel: string;
  calendarData: number[];
  keyMetrics: { label: string; value: string }[];
  trendData: { month: string; value: number }[];
  actionPlan: { action: string; due: string; status: "closed" | "in-progress" | "open" }[];
  trendType: "bar" | "line";
  trendUnit?: string;
}

const MONTHS_TREND = ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];

const SQDC_DATA: SqdcMetric[] = [
  {
    key: "S", fullName: "Safety", icon: ShieldCheck,
    score: 100, scoreLabel: "100%", status: "green", statusLabel: "GREEN",
    calendarData: Array(35).fill(0).map((_, i) => (i === 12 ? 1 : 0)),
    keyMetrics: [
      { label: "Days W/O Incident", value: "90" },
      { label: "Incidents / Mo", value: "0" },
    ],
    trendData: MONTHS_TREND.map((month, i) => ({ month, value: [0, 0, 1, 0, 2, 0][i] })),
    actionPlan: [
      { action: "Design PLC lockout procedure", due: "Feb 9", status: "closed" },
      { action: "HMI screen safety review", due: "Mar 31", status: "open" },
    ],
    trendType: "bar",
  },
  {
    key: "Q", fullName: "Quality", icon: Star,
    score: 80, scoreLabel: "80%", status: "yellow", statusLabel: "YELLOW",
    calendarData: Array(35).fill(0).map((_, i) => ([5, 11, 14, 22, 27].includes(i) ? 1 : [8, 19].includes(i) ? 2 : 0)),
    keyMetrics: [
      { label: "OFT Rate", value: "80%" },
      { label: "In Review", value: "1" },
    ],
    trendData: MONTHS_TREND.map((month, i) => ({ month, value: [75, 82, 78, 85, 80, 80][i] })),
    actionPlan: [
      { action: "Order calibration parts", due: "Feb 28", status: "in-progress" },
    ],
    trendType: "line", trendUnit: "%",
  },
  {
    key: "D", fullName: "Delivery", icon: Truck,
    score: 100, scoreLabel: "100%", status: "green", statusLabel: "GREEN",
    calendarData: Array(35).fill(0).map((_, i) => ([15, 16, 17].includes(i) ? 1 : 0)),
    keyMetrics: [
      { label: "On-Time", value: "100%" },
      { label: "At Risk", value: "0" },
    ],
    trendData: MONTHS_TREND.map((month, i) => ({ month, value: [88, 92, 100, 95, 100, 100][i] })),
    actionPlan: [
      { action: "Electrical panel audit", due: "Apr 14", status: "open" },
    ],
    trendType: "line", trendUnit: "%",
  },
  {
    key: "C", fullName: "Cost", icon: DollarSign,
    score: 6, scoreLabel: "6%", status: "red", statusLabel: "RED",
    calendarData: Array(35).fill(0).map((_, i) => ([3, 9, 14, 20, 26, 30].includes(i) ? 2 : [6, 17].includes(i) ? 1 : 0)),
    keyMetrics: [
      { label: "Variance", value: "-79%" },
      { label: "Pending", value: "$387k" },
    ],
    trendData: MONTHS_TREND.map((month, i) => ({ month, value: [180000, 220000, 310000, 260000, 350000, 387000][i] })),
    actionPlan: [
      { action: "Site survey quote review", due: "Mar 19", status: "in-progress" },
    ],
    trendType: "bar",
  },
];

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

const ACTION_STATUS_STYLE = {
  closed: "bg-green-900/70 text-green-300",
  "in-progress": "bg-blue-900/70 text-blue-300",
  open: "bg-orange-900/70 text-orange-300",
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
        <div className={cn(colors.letterBg, "rounded-lg w-14 h-14 flex items-center justify-center flex-shrink-0")}>
          <span className="text-4xl font-black text-white leading-none">{m.key}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">{m.fullName}</p>
          <p className="text-4xl font-black leading-none mt-0.5 text-white">{m.scoreLabel}</p>
          <p className="text-[10px] uppercase text-white/40 mt-0.5 tracking-wider">SCORE</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-3">
        <div className={cn("w-2 h-2 rounded-full", colors.dotColor)} />
        <span className={cn("text-[10px] font-bold uppercase tracking-widest", colors.statusText)}>{m.statusLabel}</span>
      </div>
      <p className="text-[9px] text-white/30 mt-1 uppercase tracking-widest flex items-center gap-0.5">
        {isExpanded ? "Tap to close" : "Click for details"}
        <ChevronRight className={cn("w-2.5 h-2.5 inline transition-transform", isExpanded && "rotate-90")} />
      </p>
    </button>
  );
}

// ── Snippet panel (drops below tiles on click) ─────────────────────────────────
function SqdcSnippetPanel({
  m, colors, onMoreInfo,
}: {
  m: SqdcMetric;
  colors: typeof COL[keyof typeof COL];
  onMoreInfo: () => void;
}) {
  const fmt = (v: number) =>
    m.trendUnit === "%" ? `${v}%` : v >= 1000 ? `$${Math.round(v / 1000)}k` : v.toString();

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
            <SqdcCalendar data={m.calendarData} />
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
            </div>
          </div>
          {/* Action Plan */}
          <div className="bg-black/25 rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-2">Action Plan</p>
            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-1 text-[9px] uppercase tracking-widest text-white/40 font-bold pb-1.5 border-b border-white/10">
                <span>Action</span><span>Due</span><span>Status</span>
              </div>
              {m.actionPlan.map((ap, i) => (
                <div key={i} className="grid grid-cols-3 gap-1 items-center py-0.5">
                  <span className="text-[10px] truncate text-white/80">{ap.action}</span>
                  <span className="text-[10px] text-white/50">{ap.due}</span>
                  <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-medium capitalize", ACTION_STATUS_STYLE[ap.status])}>
                    {ap.status === "in-progress" ? "In Progress" : ap.status.charAt(0).toUpperCase() + ap.status.slice(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* More Info button */}
        <div className="flex justify-end mt-3 pt-3 border-t border-white/10">
          <Button
            size="sm"
            variant="ghost"
            className="text-white/70 hover:text-white hover:bg-white/10 text-xs gap-1.5 h-8"
            onClick={onMoreInfo}
          >
            More Info <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Full detail view (opened via "More Info") ──────────────────────────────────
function SqdcFullDetail({
  m, colors, onBack,
}: {
  m: SqdcMetric;
  colors: typeof COL[keyof typeof COL];
  onBack: () => void;
}) {
  const fmt = (v: number) =>
    m.trendUnit === "%" ? `${v}%` : v >= 1000 ? `$${Math.round(v / 1000)}k` : v.toString();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.22 }}
    >
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="mb-4 gap-1.5 text-muted-foreground hover:text-foreground -ml-1"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Board
      </Button>

      {/* Full-width header tile */}
      <div className={cn("rounded-xl border p-5 mb-5", colors.headerBg)}>
        <div className="flex items-center gap-5 flex-wrap">
          <div className={cn(colors.letterBg, "rounded-xl w-20 h-20 flex items-center justify-center flex-shrink-0")}>
            <span className="text-5xl font-black text-white leading-none">{m.key}</span>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">{m.fullName}</p>
            <p className="text-5xl font-black leading-none mt-0.5 text-white">{m.scoreLabel}</p>
            <p className="text-[10px] uppercase text-white/40 mt-1 tracking-wider">SCORE</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className={cn("w-3 h-3 rounded-full", colors.dotColor)} />
            <span className={cn("text-sm font-bold uppercase tracking-widest", colors.statusText)}>{m.statusLabel}</span>
          </div>
        </div>
      </div>

      {/* Detail sections — 2×2 grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Calendar */}
        <div className="bg-card border border-border/60 rounded-xl p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">Status Calendar</p>
          <SqdcCalendar data={m.calendarData} size="lg" />
        </div>

        {/* Key Metrics */}
        <div className="bg-card border border-border/60 rounded-xl p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">Key Metrics</p>
          <div className="flex flex-col gap-3">
            {m.keyMetrics.map((km, i) => (
              <div key={i} className={cn("rounded-lg px-4 py-3 border", colors.metricBg)}>
                <p className="text-3xl font-black leading-none">{km.value}</p>
                <p className="text-xs mt-1 opacity-80">{km.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 6-Month Trend */}
        <div className="bg-card border border-border/60 rounded-xl p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">6-Month Trend</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              {m.trendType === "bar" ? (
                <BarChart data={m.trendData} barSize={16}>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                    formatter={(v: number) => [fmt(v), m.fullName]}
                  />
                  <Bar dataKey="value" fill={colors.chartColor} radius={[3, 3, 0, 0]} />
                </BarChart>
              ) : (
                <LineChart data={m.trendData}>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
                  <YAxis hide domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                    formatter={(v: number) => [fmt(v), m.fullName]}
                  />
                  <Line type="monotone" dataKey="value" stroke={colors.chartColor} strokeWidth={2.5} dot={{ r: 4, fill: colors.chartColor }} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        {/* Action Plan */}
        <div className="bg-card border border-border/60 rounded-xl p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-3">Action Plan</p>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-xs uppercase tracking-widest text-muted-foreground font-bold pb-2 border-b border-border">
              <span>Action</span><span>Due</span><span>Status</span>
            </div>
            {m.actionPlan.map((ap, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 items-center py-1.5">
                <span className="text-sm truncate text-foreground">{ap.action}</span>
                <span className="text-sm text-muted-foreground">{ap.due}</span>
                <span className={cn("text-xs px-2 py-1 rounded-md font-medium capitalize", ACTION_STATUS_STYLE[ap.status])}>
                  {ap.status === "in-progress" ? "In Progress" : ap.status.charAt(0).toUpperCase() + ap.status.slice(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── SQDC Dashboard (admin) ────────────────────────────────────────────────────
function SqdcDashboard() {
  const [expanded, setExpanded] = useState<"S" | "Q" | "D" | "C" | null>(null);
  const [fullDetail, setFullDetail] = useState<"S" | "Q" | "D" | "C" | null>(null);

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

  const overallStatus = SQDC_DATA.some(m => m.status === "red") ? "red"
    : SQDC_DATA.some(m => m.status === "yellow") ? "yellow" : "green";
  const overallLabel = { green: "ON TARGET", yellow: "AT RISK", red: "OFF TARGET" }[overallStatus];
  const overallBadge = {
    green: "bg-green-900/50 text-green-300 border-green-700",
    yellow: "bg-yellow-900/40 text-yellow-300 border-yellow-700",
    red: "bg-red-900/40 text-red-300 border-red-700",
  }[overallStatus];

  function toggle(key: "S" | "Q" | "D" | "C") {
    setExpanded(prev => prev === key ? null : key);
  }

  function openFullDetail(key: "S" | "Q" | "D" | "C") {
    setFullDetail(key);
    setExpanded(null);
  }

  function closeFullDetail() {
    setFullDetail(null);
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

      <AnimatePresence mode="wait">
        {/* ── Full Detail View ───────────────────────────────────────────── */}
        {fullDetail ? (
          <SqdcFullDetail
            key="full-detail"
            m={SQDC_DATA.find(m => m.key === fullDetail)!}
            colors={COL[fullDetail]}
            onBack={closeFullDetail}
          />
        ) : (
          <motion.div
            key="board"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {/* ── SQDC Tiles ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {SQDC_DATA.map((m, i) => (
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
                    colors={COL[m.key]}
                    onClick={() => toggle(m.key)}
                    isExpanded={expanded === m.key}
                  />
                </motion.div>
              ))}

              {/* Snippet panel — col-span-full so it appears below all tiles */}
              <AnimatePresence>
                {expanded && (
                  <SqdcSnippetPanel
                    key={expanded}
                    m={SQDC_DATA.find(m => m.key === expanded)!}
                    colors={COL[expanded]}
                    onMoreInfo={() => openFullDetail(expanded)}
                  />
                )}
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
        )}
      </AnimatePresence>
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
