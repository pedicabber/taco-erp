import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { Bell, CheckCheck, AlertTriangle, Clock, User, Tag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

const TYPE_ICONS: Record<string, React.ElementType> = {
  overdue: AlertTriangle,
  assigned: User,
  mentioned: Tag,
  status_changed: CheckCheck,
  timer_alert: Clock,
  followed: Bell,
};

const TYPE_COLORS: Record<string, string> = {
  overdue: "text-red-500",
  assigned: "text-blue-500",
  mentioned: "text-purple-500",
  status_changed: "text-green-500",
  timer_alert: "text-orange-500",
  followed: "text-primary",
};

export default function NotificationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get("/notifications").then(r => r.data),
    refetchInterval: 15000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => apiClient.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => apiClient.patch("/notifications/read-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast({ title: "All notifications marked as read" });
    },
  });

  const unread = (notifications as any[]).filter(n => !n.isRead);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6" />
            Notifications
          </h1>
          {unread.length > 0 && (
            <p className="text-muted-foreground text-sm mt-1">{unread.length} unread</p>
          )}
        </div>
        {unread.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            {markAllReadMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <CheckCheck className="w-4 h-4 mr-2" />
            )}
            Mark all read
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <Bell className="w-12 h-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No notifications yet</p>
          <p className="text-sm text-muted-foreground mt-1">You'll see alerts here when tasks are overdue or assigned to you</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(notifications as any[]).map((n, i) => {
            const Icon = TYPE_ICONS[n.type] ?? Bell;
            const iconColor = TYPE_COLORS[n.type] ?? "text-primary";
            return (
              <motion.div
                key={n.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Card className={cn(!n.isRead && "border-primary/30 bg-primary/5")}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className={cn("mt-0.5 flex-shrink-0", iconColor)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm">{n.message}</p>
                        {!n.isRead && (
                          <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </span>
                        {n.taskId && (
                          <Link href={`/tasks/${n.taskId}`}>
                            <span className="text-xs text-primary hover:underline cursor-pointer">View task</span>
                          </Link>
                        )}
                        {!n.isRead && (
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => markReadMutation.mutate(n.id)}
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
