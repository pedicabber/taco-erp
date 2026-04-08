import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { FolderKanban, CheckSquare, Clock, AlertTriangle, TrendingUp, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import type { Project, ActivityItem } from "@/lib/types";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  delay = 0,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  color: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
    >
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

export default function DashboardPage() {
  const { data: currentUser } = useCurrentUser();

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
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, <span className="text-foreground font-medium">{currentUser?.name ?? "..."}</span>
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={FolderKanban}
          label="Active Projects"
          value={summary?.activeProjects ?? "—"}
          sub={`${summary?.totalProjects ?? 0} total`}
          color="bg-blue-500"
          delay={0}
        />
        <StatCard
          icon={CheckSquare}
          label="Total Tasks"
          value={summary?.totalTasks ?? "—"}
          sub={`${summary?.tasksCompleted ?? 0} completed`}
          color="bg-green-500"
          delay={0.05}
        />
        <StatCard
          icon={Clock}
          label="In Progress"
          value={summary?.tasksInProgress ?? "—"}
          sub="tasks active"
          color="bg-orange-500"
          delay={0.1}
        />
        <StatCard
          icon={AlertTriangle}
          label="Overdue"
          value={summary?.overdueTasks ?? "—"}
          sub={`${summary?.myOverdueTasks ?? 0} mine`}
          color="bg-red-500"
          delay={0.15}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Projects */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          <Card>
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
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{project.name}</p>
                          <p className="text-xs text-muted-foreground">{project.company}</p>
                        </div>
                        <Badge variant={project.status === "active" ? "default" : "secondary"} className="ml-2 flex-shrink-0 capitalize">
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

        {/* Activity Feed */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          <Card>
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
                      <div className="min-w-0">
                        <p className="text-sm">
                          <span className="font-medium">{log.actorName}</span>{" "}
                          <span className="text-muted-foreground">{log.action}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
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
