import { useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { apiClient, getApiUrl } from "@/lib/apiClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type {
  LotoRecord,
  LotoEvent,
  LotoAttachment,
  LotoChecklistSection,
  LotoDashboardSummary,
  LotoReleaseChecklist,
  UserProfileMini,
} from "@workspace/api-client-react";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldAlert,
  Plus,
  Lock,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  FileText,
  Upload,
  Loader2,
  Trash2,
  Paperclip,
  History,
  ChevronRight,
  Unlock,
  ShieldCheck,
  Download,
  Search,
  Notebook,
  Zap,
  Users,
} from "lucide-react";

type View = "active" | "review" | "history";

const STATUS_LABEL: Record<LotoRecord["status"], string> = {
  draft: "Draft",
  active: "Active",
  pending_review: "Pending Review",
  closed: "Closed",
};

const STATUS_VARIANT: Record<
  LotoRecord["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  active: "default",
  pending_review: "secondary",
  closed: "secondary",
};

type Severity = LotoRecord["severity"];

const SEVERITY_META: Record<
  Severity,
  { label: string; className: string }
> = {
  low: { label: "Low", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30" },
  medium: { label: "Medium", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  high: { label: "High", className: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30" },
  critical: { label: "Critical", className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/40" },
};

const SEVERITY_ORDER: Severity[] = ["low", "medium", "high", "critical"];

const RELEASE_CHECKS: { key: keyof Omit<LotoReleaseChecklist, "note">; label: string }[] = [
  { key: "workComplete", label: "Work complete" },
  { key: "toolsRemoved", label: "Tools removed" },
  { key: "guardsInstalled", label: "Guards / covers reinstalled" },
  { key: "areaCleaned", label: "Area cleaned" },
  { key: "personnelClear", label: "All personnel clear" },
];

const ALLOWED_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSize(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

function userName(users: UserProfileMini[], id: number | null | undefined): string {
  if (id == null) return "—";
  return users.find((u) => u.id === id)?.name ?? `#${id}`;
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const meta = SEVERITY_META[severity];
  return (
    <Badge variant="outline" className={`gap-1 ${meta.className}`}>
      {severity === "critical" && <AlertTriangle className="w-3 h-3" />}
      {meta.label}
    </Badge>
  );
}

export default function SafetyPage() {
  const { data: currentUser } = useCurrentUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const search = useSearch();

  const [view, setView] = useState<View>("active");
  const [createOpen, setCreateOpen] = useState(false);

  // Deep-link: /safety?loto=ID opens the detail dialog (used by project banner).
  const deepLinkId = useMemo(() => {
    const raw = new URLSearchParams(search).get("loto");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isNaN(n) ? null : n;
  }, [search]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const activeId = selectedId ?? deepLinkId;

  const canWrite = !!currentUser?.safetyAccess;
  const isAdmin = currentUser?.role === "admin";

  const { data: summary } = useQuery<LotoDashboardSummary>({
    queryKey: ["loto-summary"],
    queryFn: () => apiClient.get("/loto/dashboard-summary").then((r) => r.data),
    refetchInterval: 60000,
  });

  const { data: records, isLoading } = useQuery<LotoRecord[]>({
    queryKey: ["loto-list"],
    queryFn: () => apiClient.get("/loto").then((r) => r.data),
  });

  const { data: users } = useQuery<UserProfileMini[]>({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/users").then((r) => r.data),
  });

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then((r) => r.data),
  });

  const grouped = useMemo(() => {
    const all = records ?? [];
    // "Active LOTO" view holds the live working set: drafts being set up and
    // active lockouts. Pending Review and History are their own tabs.
    const active = all
      .filter((r) => r.status === "draft" || r.status === "active")
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1));
    return {
      active,
      review: all.filter((r) => r.status === "pending_review"),
      history: all.filter((r) => r.status === "closed"),
    };
  }, [records]);

  const createMut = useMutation({
    mutationFn: (body: {
      projectId: number;
      equipmentName: string;
      equipmentLocation: string | null;
      description: string | null;
      severity: Severity;
      commanderId: number | null;
      lockedOutById: number | null;
      additionalPersonnel: number[];
    }) => apiClient.post("/loto", body).then((r) => r.data as LotoRecord),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["loto-list"] });
      qc.invalidateQueries({ queryKey: ["loto-summary"] });
      setCreateOpen(false);
      setSelectedId(rec.id);
      setView("active");
      toast({ title: "LOTO draft created", description: rec.lotoNumber });
    },
    onError: (err: Error) =>
      toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const cards = [
    { label: "Draft", value: summary?.draft ?? 0, icon: FileText, tone: "text-muted-foreground" },
    { label: "Active", value: summary?.active ?? 0, icon: Lock, tone: "text-amber-500" },
    { label: "Pending Review", value: summary?.pendingReview ?? 0, icon: Clock, tone: "text-blue-500" },
    { label: "Closed (month)", value: summary?.closedThisMonth ?? 0, icon: ShieldCheck, tone: "text-green-500" },
    { label: "Critical Active", value: summary?.criticalActive ?? 0, icon: AlertTriangle, tone: "text-red-500" },
  ];

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl" data-testid="page-safety">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <ShieldAlert className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Safety — Lockout/Tagout</h1>
            <p className="text-sm text-muted-foreground">
              Digital LOTO control. Company-wide visibility, permanent audit trail.
            </p>
          </div>
        </div>
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)} data-testid="button-new-loto">
            <Plus className="w-4 h-4 mr-1" /> New LOTO
          </Button>
        )}
      </div>

      {/* Dashboard cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label} data-testid={`card-summary-${c.label}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Icon className={`w-4 h-4 ${c.tone}`} />
                  <span className="truncate">{c.label}</span>
                </div>
                <div className="text-2xl font-bold">{c.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as View)} className="mb-4">
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active">
            Active LOTO ({grouped.active.length})
          </TabsTrigger>
          <TabsTrigger value="review" data-testid="tab-review">
            Pending Commander Review ({grouped.review.length})
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            LOTO History ({grouped.history.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "history" ? (
        <HistoryView
          records={grouped.history}
          users={users ?? []}
          projects={projects ?? []}
          loading={isLoading}
          onOpen={(id) => setSelectedId(id)}
        />
      ) : isLoading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
      ) : grouped[view].length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {view === "active"
            ? "No active or draft LOTO records."
            : "No LOTO records awaiting commander review."}
        </Card>
      ) : (
        <div className="space-y-2">
          {grouped[view].map((r) => (
            <LotoRow
              key={r.id}
              record={r}
              users={users ?? []}
              projects={projects ?? []}
              onOpen={() => setSelectedId(r.id)}
            />
          ))}
        </div>
      )}

      <CreateLotoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={projects ?? []}
        users={users ?? []}
        busy={createMut.isPending}
        onSubmit={(body) => createMut.mutate(body)}
      />

      {activeId !== null && (
        <LotoDetailDialog
          lotoId={activeId}
          users={users ?? []}
          projects={projects ?? []}
          canWrite={canWrite}
          isAdmin={isAdmin}
          currentUserId={currentUser?.id ?? null}
          onClose={() => {
            setSelectedId(null);
            // Clear the deep-link param so closing fully dismisses the dialog.
            if (deepLinkId !== null) {
              window.history.replaceState({}, "", window.location.pathname);
            }
          }}
        />
      )}
    </div>
  );
}

function LotoRow({
  record,
  users,
  projects,
  onOpen,
}: {
  record: LotoRecord;
  users: UserProfileMini[];
  projects: Project[];
  onOpen: () => void;
}) {
  const project = projects.find((p) => p.id === record.projectId);
  const doneCount = record.checklist.filter((s) => s.complete).length;
  return (
    <Card
      className="p-3 flex items-center gap-3 cursor-pointer hover-elevate"
      onClick={onOpen}
      data-testid={`loto-row-${record.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{record.lotoNumber}</span>
          <span className="font-medium truncate">{record.equipmentName}</span>
          <Badge variant={STATUS_VARIANT[record.status]}>{STATUS_LABEL[record.status]}</Badge>
          <SeverityBadge severity={record.severity} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
          <span>Project: {project?.name ?? `#${record.projectId}`}</span>
          <span>Commander: {userName(users, record.commanderId)}</span>
          {record.status === "draft" && <span>Checklist: {doneCount}/{record.checklist.length}</span>}
          {record.status === "active" && <span>Activated: {fmtDateTime(record.activatedAt)}</span>}
          {record.status === "pending_review" && (
            <span>Requested: {fmtDateTime(record.releaseRequestedAt)}</span>
          )}
          {record.status === "closed" && <span>Closed: {fmtDateTime(record.closedAt)}</span>}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </Card>
  );
}

function HistoryView({
  records,
  users,
  projects,
  loading,
  onOpen,
}: {
  records: LotoRecord[];
  users: UserProfileMini[];
  projects: Project[];
  loading: boolean;
  onOpen: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState<string>("all");
  const [projectId, setProjectId] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return records.filter((r) => {
      if (severity !== "all" && r.severity !== severity) return false;
      if (projectId !== "all" && String(r.projectId) !== projectId) return false;
      if (!needle) return true;
      const project = projects.find((p) => p.id === r.projectId);
      const haystack = [
        r.lotoNumber,
        r.equipmentName,
        r.equipmentLocation ?? "",
        r.description ?? "",
        project?.name ?? "",
        userName(users, r.commanderId),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [records, q, severity, projectId, projects, users]);

  function exportCsv() {
    const header = [
      "LOTO Number",
      "Equipment",
      "Location",
      "Project",
      "Severity",
      "Commander",
      "Locked Out By",
      "Created By",
      "Activated",
      "Closed By",
      "Closed At",
    ];
    const rows = filtered.map((r) => {
      const project = projects.find((p) => p.id === r.projectId);
      return [
        r.lotoNumber,
        r.equipmentName,
        r.equipmentLocation ?? "",
        project?.name ?? `#${r.projectId}`,
        SEVERITY_META[r.severity].label,
        userName(users, r.commanderId),
        userName(users, r.lockedOutById),
        userName(users, r.createdById),
        r.activatedAt ? new Date(r.activatedAt).toISOString() : "",
        userName(users, r.closedById),
        r.closedAt ? new Date(r.closedAt).toISOString() : "",
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `loto-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search closed LOTO records…"
            className="pl-8"
            data-testid="input-history-search"
          />
        </div>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-[150px]" data-testid="select-history-severity">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {SEVERITY_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {SEVERITY_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-[170px]" data-testid="select-history-project">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          data-testid="button-export-csv"
        >
          <Download className="w-4 h-4 mr-1" /> Export CSV
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {records.length === 0
            ? "No closed LOTO records yet."
            : "No records match your filters."}
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <LotoRow
              key={r.id}
              record={r}
              users={users}
              projects={projects}
              onOpen={() => onOpen(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateLotoDialog({
  open,
  onOpenChange,
  projects,
  users,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projects: Project[];
  users: UserProfileMini[];
  busy: boolean;
  onSubmit: (body: {
    projectId: number;
    equipmentName: string;
    equipmentLocation: string | null;
    description: string | null;
    severity: Severity;
    commanderId: number | null;
    lockedOutById: number | null;
    additionalPersonnel: number[];
  }) => void;
}) {
  const [projectId, setProjectId] = useState<string>("");
  const [equipmentName, setEquipmentName] = useState("");
  const [equipmentLocation, setEquipmentLocation] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [commanderId, setCommanderId] = useState<string>("unassigned");
  const [lockedOutById, setLockedOutById] = useState<string>("unassigned");
  const [personnel, setPersonnel] = useState<number[]>([]);

  function reset() {
    setProjectId("");
    setEquipmentName("");
    setEquipmentLocation("");
    setDescription("");
    setSeverity("medium");
    setCommanderId("unassigned");
    setLockedOutById("unassigned");
    setPersonnel([]);
  }

  function handleSubmit() {
    if (!projectId || !equipmentName.trim()) return;
    onSubmit({
      projectId: Number(projectId),
      equipmentName: equipmentName.trim(),
      equipmentLocation: equipmentLocation.trim() || null,
      description: description.trim() || null,
      severity,
      commanderId: commanderId === "unassigned" ? null : Number(commanderId),
      lockedOutById: lockedOutById === "unassigned" ? null : Number(lockedOutById),
      additionalPersonnel: personnel,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent data-testid="dialog-create-loto">
        <DialogHeader>
          <DialogTitle>New LOTO record</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger data-testid="select-project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loto-equip">Equipment</Label>
            <Input
              id="loto-equip"
              value={equipmentName}
              onChange={(e) => setEquipmentName(e.target.value)}
              placeholder="What is being locked out?"
              data-testid="input-equipment"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loto-loc">Location</Label>
            <Input
              id="loto-loc"
              value={equipmentLocation}
              onChange={(e) => setEquipmentLocation(e.target.value)}
              placeholder="Optional — where is it?"
              data-testid="input-location"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loto-desc">Description</Label>
            <Textarea
              id="loto-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details / scope of work"
              rows={3}
              data-testid="input-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
                <SelectTrigger data-testid="select-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SEVERITY_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>LOTO Commander</Label>
              <Select value={commanderId} onValueChange={setCommanderId}>
                <SelectTrigger data-testid="select-commander">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Locked out by</Label>
            <Select value={lockedOutById} onValueChange={setLockedOutById}>
              <SelectTrigger data-testid="select-locked-out-by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PersonnelPicker users={users} selected={personnel} onChange={setPersonnel} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={busy || !projectId || !equipmentName.trim()}
            data-testid="button-submit-loto"
          >
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonnelPicker({
  users,
  selected,
  onChange,
  disabled,
}: {
  users: UserProfileMini[];
  selected: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  function toggle(id: number, checked: boolean) {
    if (checked) onChange(Array.from(new Set([...selected, id])));
    else onChange(selected.filter((x) => x !== id));
  }
  return (
    <div className="space-y-1.5">
      <Label>Additional personnel</Label>
      <ScrollArea className="h-32 rounded-lg border p-2">
        <div className="space-y-1.5">
          {users.length === 0 && (
            <p className="text-xs text-muted-foreground">No users available.</p>
          )}
          {users.map((u) => (
            <label
              key={u.id}
              className="flex items-center gap-2 text-sm cursor-pointer"
              data-testid={`personnel-${u.id}`}
            >
              <Checkbox
                checked={selected.includes(u.id)}
                disabled={disabled}
                onCheckedChange={(c) => toggle(u.id, c === true)}
              />
              <span>{u.name}</span>
            </label>
          ))}
        </div>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">
        {selected.length} selected — workers applying personal locks alongside the commander.
      </p>
    </div>
  );
}

function LotoDetailDialog({
  lotoId,
  users,
  projects,
  canWrite,
  isAdmin,
  currentUserId,
  onClose,
}: {
  lotoId: number;
  users: UserProfileMini[];
  projects: Project[];
  canWrite: boolean;
  isAdmin: boolean;
  currentUserId: number | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: record, isLoading } = useQuery<LotoRecord>({
    queryKey: ["loto", lotoId],
    queryFn: () => apiClient.get(`/loto/${lotoId}`).then((r) => r.data),
  });

  const { data: events } = useQuery<LotoEvent[]>({
    queryKey: ["loto-events", lotoId],
    queryFn: () => apiClient.get(`/loto/${lotoId}/events`).then((r) => r.data),
  });

  const { data: attachments } = useQuery<LotoAttachment[]>({
    queryKey: ["loto-attachments", lotoId],
    queryFn: () => apiClient.get(`/loto/${lotoId}/attachments`).then((r) => r.data),
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["loto", lotoId] });
    qc.invalidateQueries({ queryKey: ["loto-events", lotoId] });
    qc.invalidateQueries({ queryKey: ["loto-list"] });
    qc.invalidateQueries({ queryKey: ["loto-summary"] });
  }

  const patchMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient.patch(`/loto/${lotoId}`, body).then((r) => r.data as LotoRecord),
    onSuccess: () => invalidateAll(),
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err as Error).message;
      toast({ title: "Update failed", description: msg, variant: "destructive" });
    },
  });

  const lifecycleMut = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: Record<string, unknown> }) =>
      apiClient.post(`/loto/${lotoId}/${action}`, body ?? {}).then((r) => r.data),
    onSuccess: (_data, vars) => {
      invalidateAll();
      const labels: Record<string, string> = {
        activate: "LOTO activated",
        "request-release": "Release requested — commander notified",
        "commander-review": "Review recorded",
        "authorize-energization": "Energization authorized",
        close: "LOTO closed",
        "work-log": "Work note logged",
      };
      toast({ title: labels[vars.action] ?? "Done" });
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err as Error).message;
      toast({ title: "Action failed", description: msg, variant: "destructive" });
    },
  });

  const auditNoteMut = useMutation({
    mutationFn: (message: string) =>
      apiClient.post(`/loto/${lotoId}/audit-notes`, { message }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loto-events", lotoId] });
      toast({ title: "Audit note added" });
    },
    onError: (err: Error) =>
      toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const isDraft = record?.status === "draft";
  const isActive = record?.status === "active";
  const isClosed = record?.status === "closed";
  const isPending = record?.status === "pending_review";
  const isCommander = isAdmin || (record != null && record.commanderId === currentUserId);
  const checklistDone = record ? record.checklist.every((s) => s.complete) : false;
  const hasCommander = record?.commanderId != null;

  function toggleSection(section: LotoChecklistSection, complete: boolean) {
    if (!record) return;
    const checklist = record.checklist.map((s) =>
      s.key === section.key ? { key: s.key, complete, notes: s.notes } : { key: s.key, complete: s.complete, notes: s.notes },
    );
    patchMut.mutate({ checklist });
  }

  function saveSectionNote(section: LotoChecklistSection, notes: string) {
    if (!record) return;
    const checklist = record.checklist.map((s) =>
      s.key === section.key
        ? { key: s.key, complete: s.complete, notes: notes || null }
        : { key: s.key, complete: s.complete, notes: s.notes },
    );
    patchMut.mutate({ checklist });
  }

  const project = record ? projects.find((p) => p.id === record.projectId) : undefined;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="dialog-loto-detail">
        {isLoading || !record ? (
          <DialogBody>
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          </DialogBody>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span className="font-mono">{record.lotoNumber}</span>
                <span>{record.equipmentName}</span>
                <Badge variant={STATUS_VARIANT[record.status]}>{STATUS_LABEL[record.status]}</Badge>
                <SeverityBadge severity={record.severity} />
              </DialogTitle>
            </DialogHeader>

            <DialogBody className="space-y-4">
            {isClosed && (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <Lock className="w-3.5 h-3.5" />
                This record is closed and immutable. Corrections may only be added by an admin as audit notes.
              </div>
            )}

            {/* Meta */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <Meta label="Project" value={project?.name ?? `#${record.projectId}`} />
              <Meta label="Location" value={record.equipmentLocation ?? "—"} />
              <Meta label="Commander" value={userName(users, record.commanderId)} />
              <Meta label="Locked out by" value={userName(users, record.lockedOutById)} />
              <Meta label="Created by" value={userName(users, record.createdById)} />
              <Meta label="Activated" value={fmtDateTime(record.activatedAt)} />
            </div>
            {record.additionalPersonnel.length > 0 && (
              <p className="text-sm">
                <span className="text-xs text-muted-foreground">Additional personnel: </span>
                <span className="font-medium">
                  {record.additionalPersonnel.map((id) => userName(users, id)).join(", ")}
                </span>
              </p>
            )}
            {record.description && (
              <p className="text-sm text-muted-foreground border-l-2 pl-3">{record.description}</p>
            )}

            {/* Draft: personnel + severity quick-edit */}
            {isDraft && canWrite && (
              <div className="space-y-3 border-t pt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">LOTO Commander</Label>
                    <Select
                      value={record.commanderId != null ? String(record.commanderId) : "unassigned"}
                      onValueChange={(v) =>
                        patchMut.mutate({ commanderId: v === "unassigned" ? null : Number(v) })
                      }
                    >
                      <SelectTrigger data-testid="select-detail-commander">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Severity</Label>
                    <Select
                      value={record.severity}
                      onValueChange={(v) => patchMut.mutate({ severity: v })}
                    >
                      <SelectTrigger data-testid="select-detail-severity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEVERITY_ORDER.map((s) => (
                          <SelectItem key={s} value={s}>
                            {SEVERITY_META[s].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Locked out by</Label>
                  <Select
                    value={record.lockedOutById != null ? String(record.lockedOutById) : "unassigned"}
                    onValueChange={(v) =>
                      patchMut.mutate({ lockedOutById: v === "unassigned" ? null : Number(v) })
                    }
                  >
                    <SelectTrigger data-testid="select-detail-locked-out-by">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <PersonnelPicker
                  users={users}
                  selected={record.additionalPersonnel}
                  onChange={(ids) => patchMut.mutate({ additionalPersonnel: ids })}
                  disabled={patchMut.isPending}
                />
              </div>
            )}

            {/* Checklist */}
            <section className="border-t pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Isolation Checklist
                <span className="text-xs font-normal text-muted-foreground">
                  {record.checklist.filter((s) => s.complete).length}/{record.checklist.length} complete
                </span>
              </h3>
              <div className="space-y-2">
                {record.checklist.map((s) => (
                  <ChecklistRow
                    key={s.key}
                    section={s}
                    editable={isDraft && canWrite}
                    busy={patchMut.isPending}
                    onToggle={(complete) => toggleSection(s, complete)}
                    onSaveNote={(notes) => saveSectionNote(s, notes)}
                  />
                ))}
              </div>
            </section>

            {/* Activate (draft) */}
            {isDraft && canWrite && (
              <section className="border-t pt-4 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => lifecycleMut.mutate({ action: "activate" })}
                  disabled={!checklistDone || !hasCommander || lifecycleMut.isPending}
                  data-testid="button-activate"
                >
                  <Lock className="w-4 h-4 mr-1" /> Activate LOTO
                </Button>
                {(!checklistDone || !hasCommander) && (
                  <p className="text-xs text-muted-foreground">
                    {!hasCommander && "Assign a commander. "}
                    {!checklistDone && "Complete all sections to activate."}
                  </p>
                )}
              </section>
            )}

            {/* Work phase (active) */}
            {isActive && (
              <WorkPhaseSection
                events={events ?? []}
                users={users}
                canWrite={canWrite}
                busy={lifecycleMut.isPending}
                onLog={(kind, message) => lifecycleMut.mutate({ action: "work-log", body: { kind, message } })}
              />
            )}

            {/* Work phase personnel (active) */}
            {isActive && canWrite && (
              <section className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
                  <Users className="w-4 h-4" /> Personnel
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">LOTO Commander</Label>
                    <Select
                      value={record.commanderId != null ? String(record.commanderId) : "unassigned"}
                      onValueChange={(v) =>
                        patchMut.mutate({ commanderId: v === "unassigned" ? null : Number(v) })
                      }
                    >
                      <SelectTrigger data-testid="select-active-commander">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Locked out by</Label>
                    <Select
                      value={record.lockedOutById != null ? String(record.lockedOutById) : "unassigned"}
                      onValueChange={(v) =>
                        patchMut.mutate({ lockedOutById: v === "unassigned" ? null : Number(v) })
                      }
                    >
                      <SelectTrigger data-testid="select-active-locked-out-by">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <PersonnelPicker
                  users={users}
                  selected={record.additionalPersonnel}
                  onChange={(ids) => patchMut.mutate({ additionalPersonnel: ids })}
                  disabled={patchMut.isPending}
                />
              </section>
            )}

            {/* Request release (active) */}
            {isActive && canWrite && (
              <RequestReleaseSection
                busy={lifecycleMut.isPending}
                onSubmit={(body) => lifecycleMut.mutate({ action: "request-release", body })}
              />
            )}

            {/* Pending review: show submitted release checklist */}
            {(isPending || isClosed) && record.releaseChecklist && (
              <ReleaseChecklistSummary
                checklist={record.releaseChecklist}
                requestedBy={userName(users, record.releaseRequestedById)}
                requestedAt={fmtDateTime(record.releaseRequestedAt)}
              />
            )}

            {/* Commander review gate (pending, not yet decided) */}
            {isPending && record.reviewDecision == null && isCommander && (
              <CommanderReviewSection
                busy={lifecycleMut.isPending}
                onSubmit={(decision, comments) =>
                  lifecycleMut.mutate({ action: "commander-review", body: { decision, comments } })
                }
              />
            )}

            {/* Review outcome (approved → awaiting authorization, or recorded) */}
            {(record.reviewDecision != null) && (
              <ReviewOutcome
                decision={record.reviewDecision}
                comments={record.reviewComments}
                reviewer={userName(users, record.reviewedById)}
                at={fmtDateTime(record.reviewedAt)}
              />
            )}

            {/* Authorize energization (approved, pending, not yet authorized) */}
            {isPending && record.reviewDecision === "approved" && record.authorizedAt == null && isCommander && (
              <AuthorizeEnergizationSection
                busy={lifecycleMut.isPending}
                onSubmit={(comments) =>
                  lifecycleMut.mutate({ action: "authorize-energization", body: { comments } })
                }
              />
            )}

            {/* Authorization record */}
            {record.authorizedAt != null && (
              <AuthorizationRecord
                authorizer={userName(users, record.authorizedById)}
                at={fmtDateTime(record.authorizedAt)}
                comments={record.authorizationComments}
              />
            )}

            {/* Close (authorized, pending) */}
            {isPending && record.authorizedAt != null && isCommander && (
              <CloseSection
                busy={lifecycleMut.isPending}
                onSubmit={(note) => lifecycleMut.mutate({ action: "close", body: { note } })}
              />
            )}

            {/* Attachments */}
            <AttachmentsSection
              lotoId={lotoId}
              attachments={attachments ?? []}
              canWrite={canWrite && !isClosed}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
            />

            {/* Audit trail */}
            <section className="border-t pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide mb-3 flex items-center gap-2">
                <History className="w-4 h-4" /> Audit Trail
              </h3>
              <ol className="space-y-2 border-l-2 pl-4">
                {(events ?? []).map((e) => (
                  <li key={e.id} className="relative" data-testid={`event-${e.id}`}>
                    <span className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-primary" />
                    <p className="text-sm">{e.message ?? e.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {userName(users, e.actorId)} · {fmtDateTime(e.createdAt)}
                      {e.type === "audit_note" && " · audit note"}
                      {e.type === "work_issue" && " · issue"}
                      {e.type === "work_note" && " · work note"}
                    </p>
                  </li>
                ))}
                {(events ?? []).length === 0 && (
                  <li className="text-xs text-muted-foreground">No events yet.</li>
                )}
              </ol>
              {isAdmin && (
                <AuditNoteForm busy={auditNoteMut.isPending} onSubmit={(m) => auditNoteMut.mutate(m)} />
              )}
            </section>
            </DialogBody>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function WorkPhaseSection({
  events,
  users,
  canWrite,
  busy,
  onLog,
}: {
  events: LotoEvent[];
  users: UserProfileMini[];
  canWrite: boolean;
  busy: boolean;
  onLog: (kind: "note" | "issue", message: string) => void;
}) {
  const [kind, setKind] = useState<"note" | "issue">("note");
  const [msg, setMsg] = useState("");
  const workEvents = events.filter((e) => e.type === "work_note" || e.type === "work_issue");

  return (
    <section className="border-t pt-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide mb-3 flex items-center gap-2">
        <Notebook className="w-4 h-4" /> Work Phase Log
        <span className="text-xs font-normal text-muted-foreground">({workEvents.length})</span>
      </h3>
      {workEvents.length > 0 ? (
        <ul className="space-y-1.5 mb-3">
          {workEvents.map((e) => (
            <li
              key={e.id}
              className="flex items-start gap-2 text-sm rounded-lg border p-2"
              data-testid={`work-event-${e.id}`}
            >
              {e.type === "work_issue" ? (
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              ) : (
                <Notebook className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p>{e.message}</p>
                <p className="text-xs text-muted-foreground">
                  {userName(users, e.actorId)} · {fmtDateTime(e.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground mb-3">
          No work-phase entries yet. Log notes or issues observed during the work.
        </p>
      )}
      {canWrite && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as "note" | "issue")}>
              <SelectTrigger className="w-[130px]" data-testid="select-work-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="note">Note</SelectItem>
                <SelectItem value="issue">Issue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start gap-2">
            <Textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="Describe the note or issue…"
              rows={2}
              className="text-sm"
              data-testid="input-work-log"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !msg.trim()}
              onClick={() => {
                onLog(kind, msg.trim());
                setMsg("");
              }}
              data-testid="button-add-work-log"
            >
              Log
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function RequestReleaseSection({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: LotoReleaseChecklist) => void;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const allChecked = RELEASE_CHECKS.every((c) => checks[c.key]);

  return (
    <section className="border-t pt-4">
      <div className="rounded-lg border-2 border-amber-500/60 bg-amber-500/5 px-3 py-3">
        <p className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Unlock className="w-4 h-4 text-amber-600" /> Request Release
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Confirm the equipment is safe to re-energize. All checks are required before submission.
        </p>
        <div className="space-y-2 mb-3">
          {RELEASE_CHECKS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={!!checks[c.key]}
                onCheckedChange={(v) => setChecks((prev) => ({ ...prev, [c.key]: v === true }))}
                data-testid={`release-check-${c.key}`}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for the commander…"
          rows={2}
          className="text-sm mb-3"
          data-testid="input-release-note"
        />
        <Button
          onClick={() =>
            onSubmit({
              workComplete: !!checks.workComplete,
              toolsRemoved: !!checks.toolsRemoved,
              guardsInstalled: !!checks.guardsInstalled,
              areaCleaned: !!checks.areaCleaned,
              personnelClear: !!checks.personnelClear,
              note: note.trim() || null,
            })
          }
          disabled={!allChecked || busy}
          data-testid="button-request-release"
        >
          <Unlock className="w-4 h-4 mr-1" /> Submit for Commander Review
        </Button>
      </div>
    </section>
  );
}

function ReleaseChecklistSummary({
  checklist,
  requestedBy,
  requestedAt,
}: {
  checklist: LotoReleaseChecklist;
  requestedBy: string;
  requestedAt: string;
}) {
  return (
    <section className="border-t pt-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide mb-2">Request-Release Checklist</h3>
      <p className="text-xs text-muted-foreground mb-2">
        Submitted by {requestedBy} on {requestedAt}.
      </p>
      <div className="space-y-1.5">
        {RELEASE_CHECKS.map((c) => (
          <div key={c.key} className="flex items-center gap-2 text-sm">
            {checklist[c.key] ? (
              <CheckCircle2 className="w-4 h-4 text-green-600" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground" />
            )}
            <span>{c.label}</span>
          </div>
        ))}
      </div>
      {checklist.note && (
        <p className="text-sm text-muted-foreground border-l-2 pl-3 mt-2">{checklist.note}</p>
      )}
    </section>
  );
}

function CommanderReviewSection({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (decision: "approved" | "rejected", comments: string | null) => void;
}) {
  const [comments, setComments] = useState("");
  return (
    <section className="border-t pt-4">
      <div className="rounded-lg border-2 border-blue-500 bg-blue-500/10 px-3 py-3">
        <p className="text-sm font-semibold mb-2 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-blue-600" /> Commander Review
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Approve to proceed to energization authorization, or reject to return the LOTO to the work phase.
        </p>
        <Textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Review comments (optional)…"
          rows={2}
          className="text-sm mb-3"
          data-testid="input-review-comments"
        />
        <div className="flex gap-2">
          <Button
            onClick={() => onSubmit("approved", comments.trim() || null)}
            disabled={busy}
            data-testid="button-review-approve"
          >
            <ShieldCheck className="w-4 h-4 mr-1" /> Approve
          </Button>
          <Button
            variant="outline"
            onClick={() => onSubmit("rejected", comments.trim() || null)}
            disabled={busy}
            data-testid="button-review-reject"
          >
            Reject
          </Button>
        </div>
      </div>
    </section>
  );
}

function ReviewOutcome({
  decision,
  comments,
  reviewer,
  at,
}: {
  decision: "approved" | "rejected";
  comments: string | null;
  reviewer: string;
  at: string;
}) {
  return (
    <section className="border-t pt-4">
      <div
        className={`rounded-lg border px-3 py-2 ${
          decision === "approved"
            ? "border-green-500/40 bg-green-500/5"
            : "border-red-500/40 bg-red-500/5"
        }`}
      >
        <p className="text-sm font-medium flex items-center gap-2">
          {decision === "approved" ? (
            <ShieldCheck className="w-4 h-4 text-green-600" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-600" />
          )}
          Review {decision === "approved" ? "approved" : "rejected"} by {reviewer}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{at}</p>
        {comments && <p className="text-sm mt-1.5">{comments}</p>}
      </div>
    </section>
  );
}

function AuthorizeEnergizationSection({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (comments: string | null) => void;
}) {
  const [comments, setComments] = useState("");
  return (
    <section className="border-t pt-4">
      <div className="rounded-lg border-2 border-orange-500 bg-orange-500/10 px-3 py-3">
        <p className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Zap className="w-4 h-4 text-orange-600" /> Authorize Energization
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Records that you authorize re-energizing this equipment. Required before close-out.
        </p>
        <Textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Authorization comments (optional)…"
          rows={2}
          className="text-sm mb-3"
          data-testid="input-authorize-comments"
        />
        <Button
          onClick={() => onSubmit(comments.trim() || null)}
          disabled={busy}
          data-testid="button-authorize-energization"
        >
          <Zap className="w-4 h-4 mr-1" /> Authorize Energization
        </Button>
      </div>
    </section>
  );
}

function AuthorizationRecord({
  authorizer,
  at,
  comments,
}: {
  authorizer: string;
  at: string;
  comments: string | null;
}) {
  return (
    <section className="border-t pt-4">
      <div className="rounded-lg border border-orange-500/40 bg-orange-500/5 px-3 py-2">
        <p className="text-sm font-medium flex items-center gap-2">
          <Zap className="w-4 h-4 text-orange-600" /> Energization authorized by {authorizer}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{at}</p>
        {comments && <p className="text-sm mt-1.5">{comments}</p>}
      </div>
    </section>
  );
}

function CloseSection({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (note: string | null) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <section className="border-t pt-4">
      <div className="rounded-lg border-2 border-green-600 bg-green-500/10 px-3 py-3">
        <p className="text-sm font-semibold mb-2 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-green-600" /> Close Out
        </p>
        <p className="text-xs text-muted-foreground mb-3">
          Closing seals this record permanently — it becomes immutable. This cannot be undone.
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Close-out note (optional)…"
          rows={2}
          className="text-sm mb-3"
          data-testid="input-close-note"
        />
        <Button
          onClick={() => onSubmit(note.trim() || null)}
          disabled={busy}
          data-testid="button-close-loto"
        >
          <Lock className="w-4 h-4 mr-1" /> Close LOTO
        </Button>
      </div>
    </section>
  );
}

function ChecklistRow({
  section,
  editable,
  busy,
  onToggle,
  onSaveNote,
}: {
  section: LotoChecklistSection;
  editable: boolean;
  busy: boolean;
  onToggle: (complete: boolean) => void;
  onSaveNote: (notes: string) => void;
}) {
  const [note, setNote] = useState(section.notes ?? "");
  const [noteDirty, setNoteDirty] = useState(false);

  return (
    <div className="rounded-lg border p-3" data-testid={`checklist-${section.key}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
          disabled={!editable || busy}
          onClick={() => onToggle(!section.complete)}
          data-testid={`toggle-${section.key}`}
          title={editable ? (section.complete ? "Mark incomplete" : "Mark complete") : "Read-only"}
        >
          {section.complete ? (
            <CheckCircle2 className="w-5 h-5 text-primary" />
          ) : (
            <Circle className="w-5 h-5" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${section.complete ? "text-foreground" : ""}`}>
            {section.title}
          </p>
          {editable ? (
            <div className="mt-2 flex items-start gap-2">
              <Textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteDirty(true);
                }}
                placeholder="Notes (optional)"
                rows={2}
                className="text-sm"
                data-testid={`note-${section.key}`}
              />
              {noteDirty && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    onSaveNote(note.trim());
                    setNoteDirty(false);
                  }}
                >
                  Save
                </Button>
              )}
            </div>
          ) : (
            section.notes && (
              <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{section.notes}</p>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentsSection({
  lotoId,
  attachments,
  canWrite,
  isAdmin,
  currentUserId,
}: {
  lotoId: number;
  attachments: LotoAttachment[];
  canWrite: boolean;
  isAdmin: boolean;
  currentUserId: number | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const deleteMut = useMutation({
    mutationFn: (attachmentId: number) =>
      apiClient.delete(`/loto/${lotoId}/attachments/${attachmentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loto-attachments", lotoId] });
      qc.invalidateQueries({ queryKey: ["loto-events", lotoId] });
      toast({ title: "Attachment removed" });
    },
    onError: (err: Error) =>
      toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  async function uploadFile(file: File) {
    const mime = file.type || "application/octet-stream";
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      toast({
        title: "Unsupported file type",
        description: "Allowed: images, PDF, and office documents.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast({ title: "File too large", description: "Maximum is 25 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const urlRes = await apiClient.post("/storage/uploads/request-url", {
        name: file.name,
        size: file.size,
        contentType: mime,
      });
      const { uploadURL, objectPath } = urlRes.data;

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": mime },
      });
      if (!putRes.ok) throw new Error(`Storage upload failed: ${putRes.status}`);

      await apiClient.post(`/loto/${lotoId}/attachments`, {
        fileName: file.name,
        objectPath,
        fileSize: file.size,
        mimeType: mime,
      });
      qc.invalidateQueries({ queryKey: ["loto-attachments", lotoId] });
      qc.invalidateQueries({ queryKey: ["loto-events", lotoId] });
      toast({ title: "Attachment added" });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err as Error).message;
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <section className="border-t pt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
          <Paperclip className="w-4 h-4" /> Attachments
          <span className="text-xs font-normal text-muted-foreground">({attachments.length})</span>
        </h3>
        {canWrite && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
              }}
              data-testid="input-attachment"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-upload"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-1" />
              )}
              Upload
            </Button>
          </>
        )}
      </div>
      {attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No attachments. Images, PDF, and office docs up to 25 MB.</p>
      ) : (
        <div className="space-y-1.5">
          {attachments.map((a) => {
            const canDelete = canWrite && (isAdmin || a.uploadedById === currentUserId);
            return (
              <div
                key={a.id}
                className="flex items-center gap-3 p-2 rounded-lg border"
                data-testid={`attachment-${a.id}`}
              >
                <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <a
                    href={getApiUrl(`/storage/objects${a.objectPath.replace(/^\/objects/, "")}`)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm truncate hover:underline"
                  >
                    {a.fileName}
                  </a>
                  {formatSize(a.fileSize) && (
                    <div className="text-xs text-muted-foreground">{formatSize(a.fileSize)}</div>
                  )}
                </div>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => {
                      if (confirm(`Remove "${a.fileName}"?`)) deleteMut.mutate(a.id);
                    }}
                    data-testid={`button-delete-attachment-${a.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AuditNoteForm({ busy, onSubmit }: { busy: boolean; onSubmit: (message: string) => void }) {
  const [msg, setMsg] = useState("");
  return (
    <div className="mt-3 flex items-start gap-2">
      <Textarea
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        placeholder="Admin audit note (correction / clarification)…"
        rows={2}
        className="text-sm"
        data-testid="input-audit-note"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !msg.trim()}
        onClick={() => {
          onSubmit(msg.trim());
          setMsg("");
        }}
        data-testid="button-add-audit-note"
      >
        Add note
      </Button>
    </div>
  );
}
