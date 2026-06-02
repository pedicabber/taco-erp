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
  UserProfileMini,
} from "@workspace/api-client-react";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
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
} from "lucide-react";

type View = "active" | "drafts" | "closed";

const STATUS_LABEL: Record<LotoRecord["status"], string> = {
  draft: "Draft",
  active: "Active",
  pending_release: "Pending Release",
  closed: "Closed",
};

const STATUS_VARIANT: Record<LotoRecord["status"], "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  active: "default",
  pending_release: "secondary",
  closed: "secondary",
};

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
    return {
      active: all.filter((r) => r.status === "active" || r.status === "pending_release"),
      drafts: all.filter((r) => r.status === "draft"),
      closed: all.filter((r) => r.status === "closed"),
    };
  }, [records]);

  const createMut = useMutation({
    mutationFn: (body: {
      projectId: number;
      equipmentName: string;
      equipmentLocation: string | null;
      description: string | null;
      severity: "standard" | "critical";
      commanderId: number | null;
    }) => apiClient.post("/loto", body).then((r) => r.data as LotoRecord),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["loto-list"] });
      qc.invalidateQueries({ queryKey: ["loto-summary"] });
      setCreateOpen(false);
      setSelectedId(rec.id);
      setView("drafts");
      toast({ title: "LOTO draft created", description: rec.lotoNumber });
    },
    onError: (err: Error) =>
      toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const cards = [
    { label: "Draft", value: summary?.draft ?? 0, icon: FileText, tone: "text-muted-foreground" },
    { label: "Active", value: summary?.active ?? 0, icon: Lock, tone: "text-amber-500" },
    { label: "Pending Release", value: summary?.pendingRelease ?? 0, icon: Clock, tone: "text-blue-500" },
    { label: "Closed (month)", value: summary?.closedThisMonth ?? 0, icon: ShieldCheck, tone: "text-green-500" },
    { label: "Critical Active", value: summary?.criticalActive ?? 0, icon: AlertTriangle, tone: "text-red-500" },
  ];

  const viewRecords = grouped[view];

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
            Active ({grouped.active.length})
          </TabsTrigger>
          <TabsTrigger value="drafts" data-testid="tab-drafts">
            Drafts ({grouped.drafts.length})
          </TabsTrigger>
          <TabsTrigger value="closed" data-testid="tab-closed">
            Closed ({grouped.closed.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading…</div>
      ) : viewRecords.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          No {view === "active" ? "active" : view} LOTO records.
        </Card>
      ) : (
        <div className="space-y-2">
          {viewRecords.map((r) => (
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
          <Badge variant={STATUS_VARIANT[record.status]} className="capitalize">
            {STATUS_LABEL[record.status]}
          </Badge>
          {record.severity === "critical" && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="w-3 h-3" /> Critical
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
          <span>Project: {project?.name ?? `#${record.projectId}`}</span>
          <span>Commander: {userName(users, record.commanderId)}</span>
          {record.status === "draft" && <span>Checklist: {doneCount}/{record.checklist.length}</span>}
          {record.status === "active" && <span>Activated: {fmtDateTime(record.activatedAt)}</span>}
          {record.status === "closed" && <span>Closed: {fmtDateTime(record.closedAt)}</span>}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </Card>
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
    severity: "standard" | "critical";
    commanderId: number | null;
  }) => void;
}) {
  const [projectId, setProjectId] = useState<string>("");
  const [equipmentName, setEquipmentName] = useState("");
  const [equipmentLocation, setEquipmentLocation] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"standard" | "critical">("standard");
  const [commanderId, setCommanderId] = useState<string>("unassigned");

  function reset() {
    setProjectId("");
    setEquipmentName("");
    setEquipmentLocation("");
    setDescription("");
    setSeverity("standard");
    setCommanderId("unassigned");
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
        <div className="space-y-4">
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
              <Select value={severity} onValueChange={(v) => setSeverity(v as "standard" | "critical")}>
                <SelectTrigger data-testid="select-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
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
        </div>
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
    onError: (err: Error) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const lifecycleMut = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: Record<string, unknown> }) =>
      apiClient.post(`/loto/${lotoId}/${action}`, body ?? {}).then((r) => r.data),
    onSuccess: (_data, vars) => {
      invalidateAll();
      const labels: Record<string, string> = {
        activate: "LOTO activated",
        "request-release": "Release requested — commander notified",
        "authorize-release": "Release authorized — LOTO closed",
        "reject-release": "Release rejected — returned to active",
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
  const isClosed = record?.status === "closed";
  const isPending = record?.status === "pending_release";
  const canReview = isPending && (isAdmin || record?.commanderId === currentUserId);
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-loto-detail">
        {isLoading || !record ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span className="font-mono">{record.lotoNumber}</span>
                <span>{record.equipmentName}</span>
                <Badge variant={STATUS_VARIANT[record.status]}>{STATUS_LABEL[record.status]}</Badge>
                {record.severity === "critical" && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="w-3 h-3" /> Critical
                  </Badge>
                )}
              </DialogTitle>
            </DialogHeader>

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
              <Meta label="Created by" value={userName(users, record.createdById)} />
              <Meta label="Activated" value={fmtDateTime(record.activatedAt)} />
              <Meta label="Closed" value={fmtDateTime(record.closedAt)} />
            </div>
            {record.description && (
              <p className="text-sm text-muted-foreground border-l-2 pl-3">{record.description}</p>
            )}

            {/* Draft: commander + severity quick-edit */}
            {isDraft && canWrite && (
              <div className="grid grid-cols-2 gap-3 border-t pt-4">
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
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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

            {/* Lifecycle actions */}
            {canWrite && (
              <section className="border-t pt-4 flex flex-wrap gap-2">
                {isDraft && (
                  <Button
                    onClick={() => lifecycleMut.mutate({ action: "activate" })}
                    disabled={!checklistDone || !hasCommander || lifecycleMut.isPending}
                    data-testid="button-activate"
                  >
                    <Lock className="w-4 h-4 mr-1" /> Activate LOTO
                  </Button>
                )}
                {isDraft && (!checklistDone || !hasCommander) && (
                  <p className="text-xs text-muted-foreground self-center">
                    {!hasCommander && "Assign a commander. "}
                    {!checklistDone && "Complete all 6 sections to activate."}
                  </p>
                )}
                {record.status === "active" && (
                  <Button
                    variant="secondary"
                    onClick={() => lifecycleMut.mutate({ action: "request-release" })}
                    disabled={lifecycleMut.isPending}
                    data-testid="button-request-release"
                  >
                    <Unlock className="w-4 h-4 mr-1" /> Request Release
                  </Button>
                )}
              </section>
            )}

            {/* Commander review gate */}
            {canReview && (
              <section className="border-t pt-4">
                <div className="rounded-lg border-2 border-blue-500 bg-blue-500/10 px-3 py-3">
                  <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-600" /> Commander Review
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Release was requested by {userName(users, record.releaseRequestedById)} on{" "}
                    {fmtDateTime(record.releaseRequestedAt)}. Authorize to close, or reject to keep active.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => lifecycleMut.mutate({ action: "authorize-release" })}
                      disabled={lifecycleMut.isPending}
                      data-testid="button-authorize"
                    >
                      <ShieldCheck className="w-4 h-4 mr-1" /> Authorize & Close
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => lifecycleMut.mutate({ action: "reject-release" })}
                      disabled={lifecycleMut.isPending}
                      data-testid="button-reject"
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </section>
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
