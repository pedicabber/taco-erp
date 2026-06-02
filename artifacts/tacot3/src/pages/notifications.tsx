import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import type { Notification, UserProfile } from "@/lib/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  Bell,
  CheckCheck,
  AlertTriangle,
  Clock,
  User,
  Tag,
  Loader2,
  Megaphone,
  Send,
  Plus,
  X,
  Search,
  Users as UsersIcon,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  general: Megaphone,
  loto_release_request: ShieldAlert,
};

const TYPE_COLORS: Record<string, string> = {
  overdue: "text-red-500",
  assigned: "text-blue-500",
  mentioned: "text-purple-500",
  status_changed: "text-green-500",
  timer_alert: "text-orange-500",
  followed: "text-primary",
  general: "text-indigo-500",
  loto_release_request: "text-amber-500",
};

type SentBroadcast = {
  broadcastId: string;
  title: string | null;
  message: string;
  createdAt: string;
  recipientCount: number;
  recipients: { id: number; name: string; avatarUrl: string | null; departmentName: string | null }[];
};

export default function NotificationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === "admin";

  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get("/notifications").then(r => r.data),
    refetchInterval: 15000,
    meta: { background: true },
  });

  const { data: sent = [], isLoading: sentLoading } = useQuery<SentBroadcast[]>({
    queryKey: ["notifications", "sent"],
    queryFn: () => apiClient.get("/notifications/sent").then(r => r.data),
    enabled: isAdmin && tab === "sent",
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

  const unread = (notifications as Notification[]).filter(n => !n.isRead);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6" />
            Notifications
          </h1>
          {unread.length > 0 && (
            <p className="text-muted-foreground text-sm mt-1">{unread.length} unread</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-notification">
              <Plus className="w-4 h-4 mr-2" />
              Create Notification
            </Button>
          )}
          {tab === "inbox" && unread.length > 0 && (
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
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "inbox" | "sent")} className="w-full">
        <TabsList className={cn("grid w-full mb-4", isAdmin ? "grid-cols-2" : "grid-cols-1")}>
          <TabsTrigger value="inbox" data-testid="tab-inbox">Inbox</TabsTrigger>
          {isAdmin && <TabsTrigger value="sent" data-testid="tab-sent">Sent</TabsTrigger>}
        </TabsList>

        <TabsContent value="inbox" className="mt-0">
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
              {(notifications as Notification[]).map((n, i) => {
                const Icon = TYPE_ICONS[n.type] ?? Bell;
                const iconColor = TYPE_COLORS[n.type] ?? "text-primary";
                const isGeneral = n.type === "general";
                return (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <Card className={cn(!n.isRead && "border-primary/30 bg-primary/5")} data-testid={`notification-${n.id}`}>
                      <CardContent className="p-4 flex items-start gap-3">
                        <div className={cn("mt-0.5 flex-shrink-0", iconColor)}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              {isGeneral && n.title && (
                                <p className="text-sm font-semibold mb-0.5">{n.title}</p>
                              )}
                              <p className="text-sm whitespace-pre-wrap break-words">{n.message}</p>
                              {isGeneral && n.senderName && (
                                <p className="text-xs text-muted-foreground mt-1">From: {n.senderName}</p>
                              )}
                            </div>
                            {!n.isRead && (
                              <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                            </span>
                            {n.taskId && (
                              <Link href={`/tasks/${n.taskId}`}>
                                <span className="text-xs text-primary hover:underline cursor-pointer">View task</span>
                              </Link>
                            )}
                            {!n.taskId && n.linkPath && (
                              <Link href={n.linkPath} onClick={() => !n.isRead && markReadMutation.mutate(n.id)}>
                                <span className="text-xs text-primary hover:underline cursor-pointer">
                                  {n.type === "loto_release_request" ? "View LOTO record" : "View"}
                                </span>
                              </Link>
                            )}
                            {!n.isRead && (
                              <button
                                className="text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => markReadMutation.mutate(n.id)}
                                data-testid={`button-mark-read-${n.id}`}
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
        </TabsContent>

        {isAdmin && (
          <TabsContent value="sent" className="mt-0">
            {sentLoading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : sent.length === 0 ? (
              <div className="flex flex-col items-center py-20 text-center">
                <Megaphone className="w-12 h-12 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No sent notifications</p>
                <p className="text-sm text-muted-foreground mt-1">General notifications you create will appear here</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sent.map((b, i) => (
                  <motion.div
                    key={b.broadcastId}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <Card data-testid={`broadcast-${b.broadcastId}`}>
                      <CardContent className="p-4 flex items-start gap-3">
                        <div className="mt-0.5 flex-shrink-0 text-indigo-500">
                          <Megaphone className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {b.title && <p className="text-sm font-semibold mb-0.5">{b.title}</p>}
                          <p className="text-sm whitespace-pre-wrap break-words">{b.message}</p>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              <UsersIcon className="w-3 h-3 mr-1" />
                              Sent to {b.recipientCount}
                            </Badge>
                          </div>
                          {b.recipients.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {b.recipients.slice(0, 8).map(r => (
                                <Badge key={r.id} variant="outline" className="text-xs font-normal">
                                  {r.name}
                                </Badge>
                              ))}
                              {b.recipients.length > 8 && (
                                <Badge variant="outline" className="text-xs font-normal">
                                  +{b.recipients.length - 8} more
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {isAdmin && (
        <CreateNotificationDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          currentUserId={currentUser?.id}
          onSent={() => {
            qc.invalidateQueries({ queryKey: ["notifications", "sent"] });
            qc.invalidateQueries({ queryKey: ["notifications"] });
          }}
        />
      )}
    </div>
  );
}

function CreateNotificationDialog({
  open,
  onOpenChange,
  currentUserId,
  onSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentUserId?: number;
  onSent: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");

  const { data: users = [] } = useQuery<UserProfile[]>({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/users").then(r => r.data),
    enabled: open,
  });

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users as UserProfile[]).filter(u => {
      if (currentUserId && u.id === currentUserId) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        (u.email?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [users, search, currentUserId]);

  const selectedUsers = useMemo(
    () => (users as UserProfile[]).filter(u => selectedIds.includes(u.id)),
    [users, selectedIds]
  );

  const sendMutation = useMutation({
    mutationFn: () =>
      apiClient.post("/notifications", {
        title: title.trim() || undefined,
        message: message.trim(),
        recipientUserIds: selectedIds,
      }),
    onSuccess: () => {
      toast({ title: "Notification sent", description: `Delivered to ${selectedIds.length} ${selectedIds.length === 1 ? "user" : "users"}` });
      onSent();
      reset();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to send notification",
        description: err?.response?.data?.error ?? "Please try again",
        variant: "destructive",
      });
    },
  });

  const reset = () => {
    setTitle("");
    setMessage("");
    setSelectedIds([]);
    setSearch("");
  };

  const toggle = (id: number) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const canSend = message.trim().length > 0 && selectedIds.length > 0 && !sendMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg" data-testid="dialog-create-notification">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-indigo-500" />
            Create Notification
          </DialogTitle>
          <DialogDescription>
            Send a general notification to selected users. This will not affect task notifications.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Title <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. ERP maintenance window this weekend"
              maxLength={200}
              data-testid="input-notification-title"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Message <span className="text-red-500">*</span></label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write the notification body..."
              rows={4}
              data-testid="textarea-notification-message"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Recipients <span className="text-red-500">*</span>
              {selectedIds.length > 0 && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({selectedIds.length} selected)
                </span>
              )}
            </label>

            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2 p-2 border rounded-md bg-muted/30">
                {selectedUsers.map(u => (
                  <Badge key={u.id} variant="secondary" className="gap-1 pr-1">
                    {u.name}
                    <button
                      onClick={() => toggle(u.id)}
                      className="hover:bg-muted-foreground/20 rounded-sm"
                      data-testid={`button-remove-recipient-${u.id}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="relative mb-2">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users..."
                className="pl-8"
                data-testid="input-recipient-search"
              />
            </div>

            <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
              {filteredUsers.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground text-center">No users found</p>
              ) : (
                filteredUsers.map(u => {
                  const checked = selectedIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggle(u.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-2.5 text-left hover:bg-accent transition-colors",
                        checked && "bg-primary/5"
                      )}
                      data-testid={`recipient-option-${u.id}`}
                    >
                      <div
                        className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0",
                          checked ? "bg-primary border-primary" : "border-input"
                        )}
                      >
                        {checked && <CheckCheck className="w-3 h-3 text-primary-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.name}</p>
                        {u.email && (
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sendMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => sendMutation.mutate()} disabled={!canSend} data-testid="button-send-notification">
            {sendMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
