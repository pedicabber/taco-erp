import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiClient } from "@/lib/apiClient";
import type { Project, Department } from "@/lib/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  Settings, Users, FolderKanban, Shield, Trash2,
  Loader2, AlertTriangle, ArrowLeft, Search, ChevronUp, ChevronDown,
  Building2, Calendar, FileText, DollarSign, Check, X, Plus, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn, formatQuoteNum } from "@/lib/utils";
import { Redirect } from "wouter";

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  departmentId: number | null;
  departmentName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  member: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  on_hold: "outline",
  cancelled: "destructive",
};

// ── Users Tab ────────────────────────────────────────────────────────────────
function UsersTab({ departments }: { departments: Department[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<number | null>(null);

  const { data: users = [], isLoading } = useQuery<UserRow[]>({
    queryKey: ["admin-users"],
    queryFn: () => apiClient.get("/users").then(r => r.data),
  });

  const patchUser = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { role?: string; departmentId?: number | null } }) =>
      apiClient.patch(`/users/${id}`, patch).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["current-user"] });
      toast({ title: "User updated" });
    },
    onError: () => toast({ title: "Failed to update user", variant: "destructive" }),
    onSettled: () => setSaving(null),
  });

  const filtered = users.filter(u =>
    [u.name, u.email, u.role].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  function handleRoleChange(userId: number, role: string) {
    setSaving(userId);
    patchUser.mutate({ id: userId, patch: { role } });
  }

  function handleDeptChange(userId: number, departmentId: number | null) {
    setSaving(userId);
    patchUser.mutate({ id: userId, patch: { departmentId } });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="outline">{users.length} users</Badge>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Department</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(u => (
              <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {u.avatarUrl ? (
                      <img src={u.avatarUrl} alt={u.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-primary">
                        {u.name?.[0]?.toUpperCase() ?? "?"}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-medium truncate">{u.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                  </div>
                </td>

                <td className="px-4 py-3">
                  <Select
                    value={u.role}
                    onValueChange={v => handleRoleChange(u.id, v)}
                    disabled={saving === u.id}
                  >
                    <SelectTrigger className="h-8 w-28 text-xs">
                      {saving === u.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <SelectValue />}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">
                        <div className="flex items-center gap-1.5">
                          <Shield className="w-3 h-3 text-red-500" /> Admin
                        </div>
                      </SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectContent>
                  </Select>
                </td>

                <td className="px-4 py-3 hidden md:table-cell">
                  <Select
                    value={u.departmentId?.toString() ?? "none"}
                    onValueChange={v => handleDeptChange(u.id, v === "none" ? null : parseInt(v, 10))}
                    disabled={saving === u.id}
                  >
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue placeholder="No dept" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No department</SelectItem>
                      {departments.map(d => (
                        <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>

                <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                  {format(new Date(u.createdAt), "MMM d, yyyy")}
                </td>

                <td className="px-4 py-3">
                  <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium capitalize", ROLE_BADGE[u.role] ?? ROLE_BADGE.member)}>
                    {u.role}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-sm">No users match your search.</div>
        )}
      </div>
    </div>
  );
}

// ── Projects Tab ─────────────────────────────────────────────────────────────
function ProjectsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "date">("date");
  const [sortAsc, setSortAsc] = useState(false);

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });

  const deleteProject = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project deleted" });
    },
    onError: () => toast({ title: "Failed to delete project", variant: "destructive" }),
  });

  const filtered = projects
    .filter(p =>
      [p.name, p.company, p.projectId, p.status].some(v => v?.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") cmp = a.name.localeCompare(b.name);
      else cmp = new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
      return sortAsc ? cmp : -cmp;
    });

  function toggleSort(field: "name" | "date") {
    if (sortBy === field) setSortAsc(v => !v);
    else { setSortBy(field); setSortAsc(true); }
  }

  function SortIcon({ field }: { field: "name" | "date" }) {
    if (sortBy !== field) return null;
    return sortAsc
      ? <ChevronUp className="w-3 h-3 ml-0.5 inline" />
      : <ChevronDown className="w-3 h-3 ml-0.5 inline" />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="outline">{projects.length} projects</Badge>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th
                className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                onClick={() => toggleSort("name")}
              >
                Project <SortIcon field="name" />
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Company</th>
              <th
                className="text-left px-4 py-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none hidden xl:table-cell"
                onClick={() => toggleSort("date")}
              >
                Created <SortIcon field="date" />
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(p => (
              <tr key={p.id} className="hover:bg-muted/30 transition-colors group">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <Link href={`/projects/${p.id}`}>
                        <span className="font-medium truncate hover:underline cursor-pointer">{p.name}</span>
                      </Link>
                      {p.projectId && (
                        <div className="text-xs text-muted-foreground">{formatQuoteNum(p.projectId)}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <Badge variant={STATUS_VARIANTS[p.status] ?? "secondary"} className="capitalize text-xs">
                    {p.status.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                  <div className="flex items-center gap-1.5">
                    {p.company && <><Building2 className="w-3 h-3 flex-shrink-0" />{p.company}</>}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground hidden xl:table-cell whitespace-nowrap">
                  {p.createdAt ? format(new Date(p.createdAt), "MMM d, yyyy") : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-destructive" />
                          Delete "{p.name}"?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete the project and all its departments and tasks. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => deleteProject.mutate(p.id)}
                        >
                          Delete Project
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-sm">No projects match your search.</div>
        )}
      </div>
    </div>
  );
}

// ── Departments Tab ───────────────────────────────────────────────────────────
const DEPT_COLORS = ["#3B82F6", "#F59E0B", "#8B5CF6", "#10B981", "#EF4444", "#06B6D4", "#EC4899", "#F97316", "#84CC16", "#A78BFA"];

function DepartmentsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addName, setAddName] = useState("");
  const [addColor, setAddColor] = useState(DEPT_COLORS[0]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(DEPT_COLORS[0]);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: departments = [], isLoading } = useQuery<Department[]>({
    queryKey: ["departments", "global"],
    queryFn: () => apiClient.get("/departments?global=true").then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; color: string }) =>
      apiClient.post("/departments", data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      toast({ title: "Department created" });
      setAdding(false);
      setAddName("");
      setAddColor(DEPT_COLORS[0]);
    },
    onError: () => toast({ title: "Failed to create department", variant: "destructive" }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name, color }: { id: number; name: string; color: string }) =>
      apiClient.patch(`/departments/${id}`, { name, color }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      toast({ title: "Department updated" });
      setEditingId(null);
    },
    onError: () => toast({ title: "Failed to update department", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/departments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      toast({ title: "Department deleted" });
      setDeleteId(null);
    },
    onError: () => toast({ title: "Failed to delete department", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Company-wide departments assigned to users. Involved departments on a project are derived from task assignments.
        </p>
        <Button size="sm" onClick={() => setAdding(v => !v)}>
          <Plus className="w-3 h-3 mr-1" />
          Add Department
        </Button>
      </div>

      {adding && (
        <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
          <p className="text-sm font-medium">New Department</p>
          <div className="flex gap-2 items-center">
            <Input
              placeholder="Department name"
              value={addName}
              onChange={e => setAddName(e.target.value)}
              className="flex-1 h-8 text-sm"
              onKeyDown={e => {
                if (e.key === "Enter" && addName.trim()) createMutation.mutate({ name: addName.trim(), color: addColor });
                if (e.key === "Escape") { setAdding(false); setAddName(""); }
              }}
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Color</p>
            <div className="flex gap-1.5 flex-wrap">
              {DEPT_COLORS.map(c => (
                <button
                  key={c}
                  className="w-6 h-6 rounded-full border-2 transition-all"
                  style={{ backgroundColor: c, borderColor: addColor === c ? "hsl(var(--foreground))" : "transparent" }}
                  onClick={() => setAddColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => { if (addName.trim()) createMutation.mutate({ name: addName.trim(), color: addColor }); }}
              disabled={!addName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setAddName(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Department</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {departments.map(dept => (
              <tr key={dept.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  {editingId === dept.id ? (
                    <div className="flex flex-col gap-2 py-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: editColor }} />
                        <Input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          className="h-7 text-sm flex-1"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === "Enter" && editName.trim()) renameMutation.mutate({ id: dept.id, name: editName.trim(), color: editColor });
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <Button size="icon" className="h-7 w-7" onClick={() => { if (editName.trim()) renameMutation.mutate({ id: dept.id, name: editName.trim(), color: editColor }); }}>
                          {renameMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="flex gap-1.5 flex-wrap pl-5">
                        {DEPT_COLORS.map(c => (
                          <button
                            key={c}
                            className="w-5 h-5 rounded-full border-2 transition-all"
                            style={{ backgroundColor: c, borderColor: editColor === c ? "hsl(var(--foreground))" : "transparent" }}
                            onClick={() => setEditColor(c)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: dept.color ?? "#6B7280" }} />
                      <span className="font-medium">{dept.name}</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => { setEditingId(dept.id); setEditName(dept.name); setEditColor(dept.color ?? DEPT_COLORS[0]); }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <AlertDialog open={deleteId === dept.id} onOpenChange={open => !open && setDeleteId(null)}>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(dept.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{dept.name}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the department. Users assigned to this department will lose their department association.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => deleteMutation.mutate(dept.id)}
                          >
                            {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {departments.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-sm">No departments yet. Add one above.</div>
        )}
      </div>
    </div>
  );
}

// ── Admin Page ───────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { data: currentUser, isLoading } = useCurrentUser();
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["departments", "global"],
    queryFn: () => apiClient.get("/departments?global=true").then(r => r.data),
    enabled: currentUser?.role === "admin",
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (currentUser?.role !== "admin") {
    return <Redirect to="/dashboard" />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/dashboard">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </button>
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <Settings className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Admin</h1>
            <p className="text-sm text-muted-foreground">Manage users, permissions, and projects</p>
          </div>
          <Badge className="ml-2 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800">
            <Shield className="w-3 h-3 mr-1" />
            Admin Only
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="mb-6">
          <TabsTrigger value="users" className="gap-2">
            <Users className="w-4 h-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="departments" className="gap-2">
            <Building2 className="w-4 h-4" />
            Departments
          </TabsTrigger>
          <TabsTrigger value="projects" className="gap-2">
            <FolderKanban className="w-4 h-4" />
            Projects
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UsersTab departments={departments} />
        </TabsContent>

        <TabsContent value="departments">
          <DepartmentsTab />
        </TabsContent>

        <TabsContent value="projects">
          <ProjectsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
