import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, getApiUrl } from "@/lib/apiClient";
import type { Eco, EcoAttachment, EcoSummary } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList, Loader2, Plus, Pencil, Upload, Download, Trash2,
  CalendarClock, FileText,
} from "lucide-react";

export const ECO_TYPES = [
  { value: "customer_request", label: "Customer Request" },
  { value: "internal_improvement", label: "Internal Improvement" },
  { value: "correction", label: "Correction" },
  { value: "scope_addition", label: "Scope Addition" },
  { value: "scope_reduction", label: "Scope Reduction" },
] as const;

export const ECO_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "implemented", label: "Implemented" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
] as const;

export const ECO_CUSTOMER_APPROVED = [
  { value: "pending", label: "Pending" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  approved: "default",
  implemented: "secondary",
  cancelled: "secondary",
  rejected: "destructive",
};

function labelFor(list: ReadonlyArray<{ value: string; label: string }>, v: string): string {
  return list.find(o => o.value === v)?.label ?? v;
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtSignedMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const formatted = fmtMoney(Math.abs(n));
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return formatted;
}

export type ReschedulePrefill = {
  delayReason: string;
  delayNotes: string;
  bumpDeliveryDays: number;
};

interface Props {
  projectId: number;
  currentUser?: { id: number; role: string } | null;
  onRequestReschedule: (prefill: ReschedulePrefill) => void;
}

export default function EcoSection({ projectId, currentUser, onRequestReschedule }: Props) {
  const [manageOpen, setManageOpen] = useState(false);

  const { data: summary, isLoading } = useQuery<EcoSummary>({
    queryKey: ["eco-summary", projectId],
    queryFn: () => apiClient.get(`/projects/${projectId}/eco-summary`).then(r => r.data),
  });

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-primary" />
          Engineering Change Orders
          {summary && summary.totalCount > 0 && (
            <Badge variant="secondary" className="text-xs">{summary.totalCount}</Badge>
          )}
        </h2>
        <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
          Manage ECOs
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Original Contract Value</div>
                <div className="font-semibold">{fmtMoney(summary?.originalContractValue)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Current Contract Value</div>
                <div className="font-semibold">{fmtMoney(summary?.currentContractValue)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total Cost Impact</div>
                <div className="font-semibold">{fmtSignedMoney(summary?.totalCostImpact)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Schedule Impact</div>
                <div className="font-semibold">
                  {summary?.totalScheduleImpactDays
                    ? `${summary.totalScheduleImpactDays > 0 ? "+" : ""}${summary.totalScheduleImpactDays} day${Math.abs(summary.totalScheduleImpactDays) !== 1 ? "s" : ""}`
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Original Delivery</div>
                <div className="font-medium text-sm">{summary?.originalDelivery ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Current Delivery</div>
                <div className="font-medium text-sm">{summary?.currentDelivery ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Approved</div>
                <div className="font-medium text-sm">{summary?.approvedCount ?? 0}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Pending (Draft)</div>
                <div className="font-medium text-sm">{summary?.pendingCount ?? 0}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ManageEcosDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        projectId={projectId}
        currentUser={currentUser}
        onRequestReschedule={onRequestReschedule}
      />
    </div>
  );
}

// ─── Manage / list dialog ────────────────────────────────────────────────────

function ManageEcosDialog({
  open,
  onOpenChange,
  projectId,
  currentUser,
  onRequestReschedule,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: number;
  currentUser?: { id: number; role: string } | null;
  onRequestReschedule: (prefill: ReschedulePrefill) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [approvedFilter, setApprovedFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Eco | null>(null);

  const query = new URLSearchParams();
  if (statusFilter !== "all") query.set("status", statusFilter);
  if (approvedFilter !== "all") query.set("customerApproved", approvedFilter);
  if (fromDate) query.set("fromDate", fromDate);
  if (toDate) query.set("toDate", toDate);
  const qs = query.toString();

  const { data: ecos = [], isLoading } = useQuery<Eco[]>({
    queryKey: ["ecos", projectId, qs],
    queryFn: () => apiClient.get(`/projects/${projectId}/ecos${qs ? `?${qs}` : ""}`).then(r => r.data),
    enabled: open,
  });

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }
  function openEdit(eco: Eco) {
    setEditing(eco);
    setEditorOpen(true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Engineering Change Orders
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {ECO_STATUSES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Label className="text-xs">Customer Approved</Label>
              <Select value={approvedFilter} onValueChange={setApprovedFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {ECO_CUSTOMER_APPROVED.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-36" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-36" />
            </div>
            <div className="ml-auto">
              <Button size="sm" onClick={openCreate}>
                <Plus className="w-4 h-4 mr-1" />
                New ECO
              </Button>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : ecos.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No ECOs match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">ECO #</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Title</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs hidden md:table-cell">Type</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">Cost</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs hidden sm:table-cell">Lead Δ</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs hidden lg:table-cell">Cust. Appr.</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Status</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs hidden lg:table-cell">Approved</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ecos.map(eco => (
                      <tr key={eco.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 font-mono text-xs">{eco.ecoNumber}</td>
                        <td className="px-3 py-2 font-medium max-w-[16rem] truncate">{eco.title}</td>
                        <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{labelFor(ECO_TYPES, eco.ecoType)}</td>
                        <td className="px-3 py-2 text-right">{fmtSignedMoney(eco.costImpact)}</td>
                        <td className="px-3 py-2 text-right hidden sm:table-cell">{eco.leadTimeImpactDays ? `${eco.leadTimeImpactDays > 0 ? "+" : ""}${eco.leadTimeImpactDays}d` : "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground capitalize hidden lg:table-cell">{labelFor(ECO_CUSTOMER_APPROVED, eco.customerApproved)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={STATUS_VARIANT[eco.status] ?? "secondary"} className="capitalize text-xs">
                            {labelFor(ECO_STATUSES, eco.status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs hidden lg:table-cell">{eco.approvalDate ?? "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(eco)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>

      <EcoEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        projectId={projectId}
        eco={editing}
        currentUser={currentUser}
        onRequestReschedule={onRequestReschedule}
      />
    </Dialog>
  );
}

// ─── Create / edit dialog ────────────────────────────────────────────────────

function EcoEditorDialog({
  open,
  onOpenChange,
  projectId,
  eco,
  currentUser,
  onRequestReschedule,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: number;
  eco: Eco | null;
  currentUser?: { id: number; role: string } | null;
  onRequestReschedule: (prefill: ReschedulePrefill) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // The ECO we are editing — either the one passed in, or the one just created
  // (so the attachment uploader and reschedule prompt become available).
  const [savedEco, setSavedEco] = useState<Eco | null>(eco);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ecoType, setEcoType] = useState<string>("customer_request");
  const [costImpact, setCostImpact] = useState<string>("");
  const [leadTimeImpactDays, setLeadTimeImpactDays] = useState<string>("");
  const [customerApproved, setCustomerApproved] = useState<string>("pending");
  const [status, setStatus] = useState<string>("draft");

  function hydrate(source: Eco | null) {
    setSavedEco(source);
    setTitle(source?.title ?? "");
    setDescription(source?.description ?? "");
    setEcoType(source?.ecoType ?? "customer_request");
    setCostImpact(source ? String(source.costImpact) : "");
    setLeadTimeImpactDays(source ? String(source.leadTimeImpactDays) : "");
    setCustomerApproved(source?.customerApproved ?? "pending");
    setStatus(source?.status ?? "draft");
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ecos", projectId] });
    qc.invalidateQueries({ queryKey: ["eco-summary", projectId] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        ecoType,
        costImpact: costImpact === "" ? 0 : Number(costImpact),
        leadTimeImpactDays: leadTimeImpactDays === "" ? 0 : Math.trunc(Number(leadTimeImpactDays)),
        customerApproved,
        status,
      };
      if (savedEco) {
        return apiClient.patch(`/projects/${projectId}/ecos/${savedEco.id}`, body).then(r => r.data as Eco);
      }
      return apiClient.post(`/projects/${projectId}/ecos`, body).then(r => r.data as Eco);
    },
    onSuccess: (result) => {
      invalidate();
      // Keep the editor open in "saved" mode so the user can attach documents
      // and explicitly choose whether to apply the schedule impact (the
      // reschedule callout below appears when leadTimeImpactDays > 0).
      setSavedEco(result);
      toast({ title: savedEco ? "ECO updated" : `ECO created (${result.ecoNumber})` });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Save failed";
      toast({ title: msg, variant: "destructive" });
    },
  });

  const disabled = saveMutation.isPending || !title.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) hydrate(eco);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {savedEco ? `Edit ${savedEco.ecoNumber}` : "New Engineering Change Order"}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Short summary of the change" />
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What is changing and why?"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>ECO Type</Label>
              <Select value={ecoType} onValueChange={setEcoType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ECO_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ECO_STATUSES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cost Impact (USD)</Label>
              <Input
                type="number"
                step="0.01"
                value={costImpact}
                onChange={e => setCostImpact(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground mt-1">Use a negative value for a reduction.</p>
            </div>
            <div>
              <Label>Lead Time Impact (days)</Label>
              <Input
                type="number"
                step="1"
                value={leadTimeImpactDays}
                onChange={e => setLeadTimeImpactDays(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <Label>Customer Approved</Label>
            <Select value={customerApproved} onValueChange={setCustomerApproved}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ECO_CUSTOMER_APPROVED.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {savedEco ? (
            <EcoAttachments
              projectId={projectId}
              eco={savedEco}
              currentUser={currentUser}
            />
          ) : (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              Save the ECO to attach supporting documents.
            </p>
          )}

          {savedEco && savedEco.leadTimeImpactDays > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <CalendarClock className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  This ECO has a schedule impact of{" "}
                  <strong>+{savedEco.leadTimeImpactDays} day{savedEco.leadTimeImpactDays !== 1 ? "s" : ""}</strong>.
                  Reschedule the project to push the delivery date out?
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    onRequestReschedule({
                      delayReason: "engineering_change_order",
                      delayNotes: `${savedEco.ecoNumber}: ${savedEco.title}`,
                      bumpDeliveryDays: savedEco.leadTimeImpactDays,
                    });
                    onOpenChange(false);
                  }}
                >
                  Open Reschedule
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                  Skip
                </Button>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={disabled}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {savedEco ? "Save Changes" : "Create ECO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ECO attachments ─────────────────────────────────────────────────────────

function ecoFileUrl(objectPath: string): string {
  return getApiUrl(`/storage/objects${objectPath.replace(/^\/objects/, "")}`);
}

function EcoAttachments({
  projectId,
  eco,
  currentUser,
}: {
  projectId: number;
  eco: Eco;
  currentUser?: { id: number; role: string } | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const { data: attachments = [] } = useQuery<EcoAttachment[]>({
    queryKey: ["eco", projectId, eco.id],
    queryFn: () => apiClient.get(`/projects/${projectId}/ecos/${eco.id}`).then(r => (r.data as Eco).attachments ?? []),
    initialData: eco.attachments ?? [],
  });

  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  async function uploadFile(file: File) {
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "File too large", description: "Maximum is 50 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const urlRes = await apiClient.post("/storage/uploads/request-url", {
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
        projectId,
      });
      const { uploadURL, objectPath } = urlRes.data;
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!putRes.ok) throw new Error(`Storage PUT failed: ${putRes.status}`);
      await apiClient.post(`/projects/${projectId}/ecos/${eco.id}/attachments`, {
        fileName: file.name,
        objectPath,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      });
      qc.invalidateQueries({ queryKey: ["eco", projectId, eco.id] });
      qc.invalidateQueries({ queryKey: ["ecos", projectId] });
      toast({ title: "Uploaded", description: file.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (attachmentId: number) =>
      apiClient.delete(`/projects/${projectId}/ecos/${eco.id}/attachments/${attachmentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eco", projectId, eco.id] });
      qc.invalidateQueries({ queryKey: ["ecos", projectId] });
      toast({ title: "Document deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    uploadFile(file);
  }

  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between mb-2">
        <Label className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" />
          Supporting Documents
        </Label>
        <Label htmlFor={`eco-file-${eco.id}`} className="cursor-pointer">
          <Button variant="outline" size="sm" asChild>
            <span>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
              Upload
            </span>
          </Button>
        </Label>
        <Input
          id={`eco-file-${eco.id}`}
          type="file"
          className="hidden"
          onChange={handleFileInput}
          disabled={uploading}
        />
      </div>

      {attachments.length === 0 ? (
        <p className="text-xs text-muted-foreground">No documents attached.</p>
      ) : (
        <div className="space-y-1.5">
          {attachments.map(a => {
            const canDelete = currentUser && (currentUser.role === "admin" || currentUser.id === a.uploadedById);
            return (
              <div key={a.id} className="flex items-center gap-2 p-2 rounded-md border text-sm">
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1 min-w-0 truncate">{a.fileName}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                  <a href={ecoFileUrl(a.objectPath)} download={a.fileName}>
                    <Download className="w-4 h-4" />
                  </a>
                </Button>
                {canDelete && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    }
                    title="Delete document?"
                    description="This will permanently remove the file. This action cannot be undone."
                    onConfirm={() => deleteMutation.mutate(a.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
