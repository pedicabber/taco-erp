import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { formatQuoteNum } from "@/lib/utils";
import type { Project } from "@/lib/types";
import {
  Info, Building2, Calendar, DollarSign, Save, X,
  Phone, Mail, MapPin, User, Hash, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  on_hold: "outline",
  cancelled: "destructive",
};

export default function ProjectInfoDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: project.name,
    company: project.company,
    projectId: project.projectId,
    description: project.description ?? "",
    fullDescription: project.fullDescription ?? "",
    startDate: project.startDate ?? "",
    status: project.status,
    address: project.address ?? "",
    contactName: project.contactName ?? "",
    contactPhone: project.contactPhone ?? "",
    contactEmail: project.contactEmail ?? "",
    totalPrice: project.totalPrice ?? "",
    deliveryDate: (project as any).deliveryDate ?? "",
    scopeOfWork: (project as any).scopeOfWork ?? "",
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiClient.patch(`/projects/${project.id}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      toast({ title: "Project updated" });
      setEditing(false);
    },
    onError: () => toast({ title: "Failed to update project", variant: "destructive" }),
  });

  function discardEdits() {
    setForm({
      name: project.name,
      company: project.company,
      projectId: project.projectId,
      description: project.description ?? "",
      fullDescription: project.fullDescription ?? "",
      startDate: project.startDate ?? "",
      status: project.status,
      address: project.address ?? "",
      contactName: project.contactName ?? "",
      contactPhone: project.contactPhone ?? "",
      contactEmail: project.contactEmail ?? "",
      totalPrice: project.totalPrice ?? "",
      deliveryDate: (project as any).deliveryDate ?? "",
      scopeOfWork: (project as any).scopeOfWork ?? "",
    });
    setEditing(false);
  }

  function field(v: string) {
    return v?.trim() || "—";
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          {/* pr-10 leaves room for the shadcn close button (absolute top-4 right-4) */}
          <div className="flex items-center justify-between pr-10">
            <DialogTitle className="flex items-center gap-2">
              <Info className="w-5 h-5 text-primary" />
              Project Info
            </DialogTitle>
            {!editing && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="space-y-5 pb-2">
            {/* ─── Core identity ─── */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Project Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">Project Name</Label>
                  {editing ? (
                    <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                  ) : (
                    <p className="font-semibold mt-0.5">{field(form.name)}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> Company
                  </Label>
                  {editing ? (
                    <Input value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{field(form.company)}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Hash className="w-3 h-3" /> Quote / Project ID
                  </Label>
                  {editing ? (
                    <Input value={form.projectId} onChange={e => setForm(p => ({ ...p, projectId: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5 font-mono text-sm">{form.projectId ? formatQuoteNum(form.projectId) : "—"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Start Date
                  </Label>
                  {editing ? (
                    <Input type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{form.startDate ? format(new Date(form.startDate), "MMM d, yyyy") : "—"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Delivery Date
                  </Label>
                  {editing ? (
                    <Input type="date" value={form.deliveryDate} onChange={e => setForm(p => ({ ...p, deliveryDate: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{form.deliveryDate ? format(new Date(form.deliveryDate), "MMM d, yyyy") : "—"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Total Price
                  </Label>
                  {editing ? (
                    <Input value={form.totalPrice} onChange={e => setForm(p => ({ ...p, totalPrice: e.target.value }))} placeholder="$0.00" />
                  ) : (
                    <p className="mt-0.5 font-semibold text-green-600 dark:text-green-400">{field(form.totalPrice)}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  {editing ? (
                    <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v as typeof form.status }))}>
                      <SelectTrigger className="mt-0.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="on_hold">On Hold</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="mt-0.5">
                      <Badge variant={STATUS_VARIANTS[form.status] ?? "secondary"} className="capitalize">
                        {form.status.replace("_", " ")}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <Separator />

            {/* ─── Contact ─── */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Contact Info</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="w-3 h-3" /> Contact Name
                  </Label>
                  {editing ? (
                    <Input value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{field(form.contactName)}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="w-3 h-3" /> Phone
                  </Label>
                  {editing ? (
                    <Input value={form.contactPhone} onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{field(form.contactPhone)}</p>
                  )}
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Email
                  </Label>
                  {editing ? (
                    <Input value={form.contactEmail} onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{field(form.contactEmail)}</p>
                  )}
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Address
                  </Label>
                  {editing ? (
                    <Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{field(form.address)}</p>
                  )}
                </div>
              </div>
            </section>

            <Separator />

            {/* ─── Brief description ─── */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Brief Description</p>
              {editing ? (
                <Textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={3}
                  placeholder="High-level description shown on project card..."
                />
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {form.description?.trim() || "No brief description."}
                </p>
              )}
            </section>

            <Separator />

            {/* ─── Scope of Work (parsed from quote) ─── */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Scope of Work</p>
              <p className="text-xs text-muted-foreground mb-2">
                Bullet-point scope from the quote description (after "including the following:").
              </p>
              {editing ? (
                <Textarea
                  value={form.scopeOfWork}
                  onChange={e => setForm(p => ({ ...p, scopeOfWork: e.target.value }))}
                  rows={6}
                  className="font-mono text-sm"
                  placeholder="Scope of work bullet points from quote..."
                />
              ) : (
                <div className="rounded-md bg-muted/40 border p-3 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                  {form.scopeOfWork?.trim() || "No scope of work recorded."}
                </div>
              )}
            </section>

            <Separator />

            {/* ─── Full line items ─── */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Full Description / Line Items</p>
              <p className="text-xs text-muted-foreground mb-2">
                All line item descriptions parsed from the quote.
              </p>
              {editing ? (
                <Textarea
                  value={form.fullDescription}
                  onChange={e => setForm(p => ({ ...p, fullDescription: e.target.value }))}
                  rows={8}
                  className="font-mono text-sm"
                  placeholder="Full line items from quote..."
                />
              ) : (
                <div className="rounded-md bg-muted/40 border p-3 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                  {form.fullDescription?.trim() || "No line items recorded."}
                </div>
              )}
            </section>
          </div>
        </ScrollArea>

        {editing && (
          <div className="flex items-center justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={discardEdits}>
              <X className="w-4 h-4 mr-1.5" />
              Discard
            </Button>
            <Button onClick={() => updateMutation.mutate(form)} disabled={updateMutation.isPending}>
              {updateMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                : <Save className="w-4 h-4 mr-1.5" />}
              Save Changes
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
