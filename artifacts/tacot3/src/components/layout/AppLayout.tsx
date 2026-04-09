import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, UserButton } from "@clerk/react";
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  Trello,
  CalendarDays,
  Bell,
  Menu,
  X,
  ChevronLeft,
  Sun,
  Moon,
  Monitor,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: FolderKanban, label: "Projects", href: "/projects" },
  { icon: CheckSquare, label: "Tasks", href: "/tasks" },
  { icon: Trello, label: "Board", href: "/board" },
  { icon: CalendarDays, label: "Calendar", href: "/calendar" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [location] = useLocation();
  const { user } = useUser();
  const { theme, setTheme } = useTheme();
  const { data: currentUser } = useCurrentUser();

  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get("/notifications").then(r => r.data),
    refetchInterval: 30000,
  });

  const unreadCount = (notifications as Array<{ isRead: boolean }> | undefined)?.filter(n => !n.isRead).length ?? 0;

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed md:relative z-30 flex flex-col h-full bg-card border-r border-border transition-all duration-300",
          sidebarOpen ? "w-56" : "w-16",
          !sidebarOpen && "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-3 py-4 border-b border-border min-h-[60px]">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <FolderKanban className="w-4 h-4 text-primary-foreground" />
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <div className="text-sm font-bold text-foreground leading-tight">TacoT3</div>
              <div className="text-[10px] text-muted-foreground leading-tight">Project Ops</div>
            </div>
          )}
          <button
            className="ml-auto hidden md:flex items-center justify-center w-6 h-6 rounded hover:bg-muted transition-colors"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <ChevronLeft className={cn("w-4 h-4 transition-transform", !sidebarOpen && "rotate-180")} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors group",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  title={!sidebarOpen ? item.label : undefined}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {sidebarOpen && <span className="text-sm font-medium truncate">{item.label}</span>}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Bottom: theme toggle + user */}
        <div className="border-t border-border p-2 space-y-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn("w-full justify-start gap-2", !sidebarOpen && "justify-center px-2")}
                title="Toggle theme"
              >
                {theme === "dark" ? <Moon className="w-4 h-4" /> : theme === "light" ? <Sun className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                {sidebarOpen && <span className="text-sm">Theme</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end">
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun className="w-4 h-4 mr-2" /> Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon className="w-4 h-4 mr-2" /> Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor className="w-4 h-4 mr-2" /> System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className={cn("flex items-center gap-2 px-2 py-1 rounded-lg", !sidebarOpen && "justify-center")}>
            <UserButton />
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{currentUser?.name ?? user?.fullName ?? "User"}</div>
                <div className="text-[10px] text-muted-foreground truncate capitalize">{currentUser?.role ?? "member"}</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card min-h-[60px]">
          <button
            className="md:hidden flex items-center justify-center w-8 h-8 rounded hover:bg-muted transition-colors"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex-1" />

          {/* Admin cog — only visible to admins */}
          {currentUser?.role === "admin" && (
            <Link href="/admin">
              <div
                className={cn(
                  "flex items-center justify-center w-9 h-9 rounded-lg hover:bg-muted transition-colors cursor-pointer",
                  location.startsWith("/admin") && "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                )}
                title="Admin Panel"
              >
                <Settings className="w-5 h-5" />
              </div>
            </Link>
          )}

          {/* Notification bell */}
          <Link href="/notifications">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-lg hover:bg-muted transition-colors cursor-pointer">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] text-[10px] px-1 flex items-center justify-center"
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Badge>
              )}
            </div>
          </Link>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
