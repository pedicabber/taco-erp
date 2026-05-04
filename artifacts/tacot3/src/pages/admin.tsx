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
  ListChecks, ChevronRight,
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  departmentId: number | null;
  departmentName: string | null;
  departmentIds: number[];
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

// ── Edit User Dialog ──────────────────────────────────────────────────────────
function EditUserDialog({
  user,
  departments,
  currentUserId,
  open,
  onOpenChange,
}: {
  user: UserRow;
  departments: Department[];
  currentUserId: number | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [selectedDeptIds, setSelectedDeptIds] = useState<Set<number>>(new Set(user.departmentIds));
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const isSelf = currentUserId !== undefined && user.id === currentUserId;

  const patchMutation = useMutation({
    mutationFn: (patch: { name: string; role: string; avatarUrl: string | null; departmentIds: number[] }) =>
      apiClient.patch(`/users/${user.id}`, patch).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["current-user"] });
      toast({ title: "User updated" });
      onOpenChange(false);
    },
    onError: () => toast({ title: "Failed to update user", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/users/${user.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "User removed" });
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to delete user";
      toast({ title: msg, variant: "destructive" });
    },
  });

  function toggleDept(deptId: number) {
    setSelectedDeptIds(prev => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }

  function handleSave() {
    patchMutation.mutate({
      name: name.trim() || user.name,
      role,
      avatarUrl: avatarUrl.trim() || null,
      departmentIds: Array.from(selectedDeptIds),
    });
  }

  const deptMap = new Map(departments.map(d => [d.id, d]));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-primary">
                    {name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <DialogTitle className="text-base truncate">{user.name}</DialogTitle>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                disabled={isSelf}
                title={isSelf ? "You cannot delete your own account" : "Delete user"}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Email</Label>
              <Input value={user.email} disabled className="bg-muted/40 cursor-not-allowed" />
              <p className="text-[10px] text-muted-foreground mt-1">Managed by authentication provider</p>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
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
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Avatar URL</Label>
              <Input
                value={avatarUrl}
                onChange={e => setAvatarUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">
                Departments
                {selectedDeptIds.size > 0 && (
                  <span className="ml-1.5 text-foreground font-medium">
                    ({selectedDeptIds.size} selected)
                  </span>
                )}
              </Label>
              {departments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No departments configured.</p>
              ) : (
                <ScrollArea className="h-40 rounded-md border p-2">
                  <div className="space-y-1">
                    {departments.map(d => (
                      <label
                        key={d.id}
                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedDeptIds.has(d.id)}
                          onCheckedChange={() => toggleDept(d.id)}
                          id={`dept-${d.id}`}
                        />
                        {d.color && (
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: d.color }}
                          />
                        )}
                        <span className="text-sm">{d.name}</span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={patchMutation.isPending}>
              {patchMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Remove "{user.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this user's ERP record and all associated data.
              Their login account will not be affected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Remove User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Users Tab ────────────────────────────────────────────────────────────────
function UsersTab({ departments }: { departments: Department[] }) {
  const { data: currentUser } = useCurrentUser();
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);

  const { data: users = [], isLoading } = useQuery<UserRow[]>({
    queryKey: ["admin-users"],
    queryFn: () => apiClient.get("/users").then(r => r.data),
  });

  const filtered = users.filter(u =>
    [u.name, u.email, u.role].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const deptMap = new Map(departments.map(d => [d.id, d]));

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
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Departments</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(u => {
              const deptIds = u.departmentIds ?? [];
              const deptNames = deptIds.length > 0
                ? deptIds.map(id => deptMap.get(id)?.name ?? "").filter(Boolean).join(", ")
                : u.departmentName ?? "—";

              return (
                <tr
                  key={u.id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => setEditingUser(u)}
                >
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
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium capitalize", ROLE_BADGE[u.role] ?? ROLE_BADGE.member)}>
                      {u.role}
                    </span>
                  </td>

                  <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                    {deptNames}
                  </td>

                  <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                    {format(new Date(u.createdAt), "MMM d, yyyy")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-sm">No users match your search.</div>
        )}
      </div>

      {editingUser && (
        <EditUserDialog
          user={editingUser}
          departments={departments}
          currentUserId={currentUser?.id}
          open={!!editingUser}
          onOpenChange={open => { if (!open) setEditingUser(null); }}
        />
      )}
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

// ── Task Templates Tab ────────────────────────────────────────────────────────
interface TemplateTask {
  id: number;
  title: string;
  sortOrder: number;
  departmentId: number;
  createdAt: string;
}

function TaskTemplatesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [addingForDeptId, setAddingForDeptId] = useState<number | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const { data: settings = {} } = useQuery<Record<string, string>>({
    queryKey: ["settings"],
    queryFn: () => apiClient.get("/settings").then(r => r.data),
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["departments", "global"],
    queryFn: () => apiClient.get("/departments?global=true").then(r => r.data),
  });

  const { data: templates = [], isLoading } = useQuery<TemplateTask[]>({
    queryKey: ["task-templates"],
    queryFn: () => apiClient.get("/task-templates").then(r => r.data),
  });

  const autoPopulate = settings["auto_populate_tasks"] !== "false";

  const settingMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiClient.put(`/settings/${key}`, { value }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
    onError: () => toast({ title: "Failed to update setting", variant: "destructive" }),
  });

  const addTaskMutation = useMutation({
    mutationFn: ({ title, departmentId }: { title: string; departmentId: number }) =>
      apiClient.post("/task-templates", { title, departmentId }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-templates"] });
      toast({ title: "Task added" });
      setAddingForDeptId(null);
      setNewTaskTitle("");
    },
    onError: () => toast({ title: "Failed to add task", variant: "destructive" }),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      apiClient.patch(`/task-templates/${id}`, { title }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-templates"] });
      toast({ title: "Task updated" });
      setEditingTaskId(null);
    },
    onError: () => toast({ title: "Failed to update task", variant: "destructive" }),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/task-templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-templates"] });
      toast({ title: "Task deleted" });
    },
    onError: () => toast({ title: "Failed to delete task", variant: "destructive" }),
  });

  // Group templates by departmentId
  const templatesByDept = new Map<number, TemplateTask[]>();
  for (const t of templates) {
    if (!templatesByDept.has(t.departmentId)) templatesByDept.set(t.departmentId, []);
    templatesByDept.get(t.departmentId)!.push(t);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Auto-populate setting */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-sm">Auto-populate tasks on project creation</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When enabled, new projects automatically receive all department tasks below.
                When disabled, you select which departments and tasks to include during project creation.
              </p>
            </div>
            <Switch
              checked={autoPopulate}
              onCheckedChange={v =>
                settingMutation.mutate({ key: "auto_populate_tasks", value: v ? "true" : "false" })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Department sections */}
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">Template Tasks by Department</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {templates.length} task{templates.length !== 1 ? "s" : ""} across {departments.length} department{departments.length !== 1 ? "s" : ""}
          </p>
        </div>

        {departments.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-sm">
            No departments configured. Add departments in the Departments tab first.
          </div>
        )}

        {departments.map(dept => {
          const deptTasks = templatesByDept.get(dept.id) ?? [];
          const isAddingHere = addingForDeptId === dept.id;

          return (
            <div key={dept.id} className="rounded-lg border overflow-hidden">
              {/* Department header */}
              <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: dept.color ?? "#64748b" }}
                  />
                  <span className="text-sm font-semibold">{dept.name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                    {deptTasks.length}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    setAddingForDeptId(isAddingHere ? null : dept.id);
                    setNewTaskTitle("");
                  }}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Task
                </Button>
              </div>

              {/* Task rows */}
              <div className="divide-y divide-border">
                {deptTasks.map(task => {
                  const isEditing = editingTaskId === task.id;
                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 px-4 py-2.5 hover:bg-muted/20 transition-colors group"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                      {isEditing ? (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Input
                            value={editingTaskTitle}
                            onChange={e => setEditingTaskTitle(e.target.value)}
                            className="h-7 text-sm flex-1"
                            autoFocus
                            onKeyDown={e => {
                              if (e.key === "Enter" && editingTaskTitle.trim())
                                updateTaskMutation.mutate({ id: task.id, title: editingTaskTitle.trim() });
                              if (e.key === "Escape") setEditingTaskId(null);
                            }}
                          />
                          <Button
                            size="icon"
                            className="h-7 w-7 flex-shrink-0"
                            onClick={() => {
                              if (editingTaskTitle.trim())
                                updateTaskMutation.mutate({ id: task.id, title: editingTaskTitle.trim() });
                            }}
                            disabled={updateTaskMutation.isPending}
                          >
                            {updateTaskMutation.isPending
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Check className="w-3 h-3" />}
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0"
                            onClick={() => setEditingTaskId(null)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 text-sm truncate">{task.title}</span>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => { setEditingTaskId(task.id); setEditingTaskTitle(task.title); }}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive">
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete "{task.title}"?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will remove the task from the template. This cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => deleteTaskMutation.mutate(task.id)}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Add task inline form */}
                {isAddingHere && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/10">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/40 flex-shrink-0" />
                    <Input
                      placeholder="Task title"
                      value={newTaskTitle}
                      onChange={e => setNewTaskTitle(e.target.value)}
                      className="h-7 text-sm flex-1"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === "Enter" && newTaskTitle.trim())
                          addTaskMutation.mutate({ title: newTaskTitle.trim(), departmentId: dept.id });
                        if (e.key === "Escape") { setAddingForDeptId(null); setNewTaskTitle(""); }
                      }}
                    />
                    <Button
                      size="icon"
                      className="h-7 w-7 flex-shrink-0"
                      onClick={() => {
                        if (newTaskTitle.trim())
                          addTaskMutation.mutate({ title: newTaskTitle.trim(), departmentId: dept.id });
                      }}
                      disabled={addTaskMutation.isPending}
                    >
                      {addTaskMutation.isPending
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Check className="w-3 h-3" />}
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0"
                      onClick={() => { setAddingForDeptId(null); setNewTaskTitle(""); }}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )}

                {deptTasks.length === 0 && !isAddingHere && (
                  <div className="px-4 py-3 text-xs text-muted-foreground italic">
                    No tasks — click "Add Task" to add one.
                  </div>
                )}
              </div>
            </div>
          );
        })}
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
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
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
        <TabsList className="mb-6 flex-wrap h-auto">
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
          <TabsTrigger value="task-templates" className="gap-2">
            <ListChecks className="w-4 h-4" />
            Task Templates
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

        <TabsContent value="task-templates">
          <TaskTemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
