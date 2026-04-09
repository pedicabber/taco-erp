import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import type { Project, ParsedTaskItem } from "@/lib/types";
import {
  Plus, FolderKanban, FileText, Search, Loader2, ChevronRight,
  Building2, Calendar, Eraser, Info, Phone, Mail, MapPin,
  DollarSign, Save, X, User, Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { motion } from "framer-motion";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  on_hold: "outline",
  cancelled: "destructive",
};

const EMPTY_FORM = {
  name: "", company: "", projectId: "", description: "", fullDescription: "",
  startDate: "", status: "active", address: "", contactName: "",
  contactPhone: "", contactEmail: "", totalPrice: "",
};

// ── Project Info Popup ──────────────────────────────────────────────────────
function ProjectInfoDialog({ project, onClose }: { project: Project; onClose: () => void }) {
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
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof form) =>
      apiClient.patch(`/projects/${project.id}`, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project updated" });
      setEditing(false);
    },
    onError: () => toast({ title: "Failed to update project", variant: "destructive" }),
  });

  function field(v: string) {
    return v?.trim() || "—";
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="w-5 h-5 text-primary" />
            Project Info
            {!editing && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            )}
          </DialogTitle>
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
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="w-3 h-3" /> Company</Label>
                  {editing ? (
                    <Input value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{field(form.company)}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><Hash className="w-3 h-3" /> Quote / Project ID</Label>
                  {editing ? (
                    <Input value={form.projectId} onChange={e => setForm(p => ({ ...p, projectId: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5 font-mono text-sm">{field(form.projectId)}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Start Date</Label>
                  {editing ? (
                    <Input type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{form.startDate ? format(new Date(form.startDate), "MMM d, yyyy") : "—"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Total Price</Label>
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
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" /> Contact Name</Label>
                  {editing ? (
                    <Input value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{field(form.contactName)}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" /> Phone</Label>
                  {editing ? (
                    <Input value={form.contactPhone} onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{field(form.contactPhone)}</p>
                  )}
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" /> Email</Label>
                  {editing ? (
                    <Input value={form.contactEmail} onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))} />
                  ) : (
                    <p className="mt-0.5">{field(form.contactEmail)}</p>
                  )}
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> Address</Label>
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

            {/* ─── Full description / scope of work ─── */}
            <section>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Scope of Work</p>
              <p className="text-xs text-muted-foreground mb-2">
                Full project scope including all line items. Edit to keep notes as the project progresses.
              </p>
              {editing ? (
                <Textarea
                  value={form.fullDescription}
                  onChange={e => setForm(p => ({ ...p, fullDescription: e.target.value }))}
                  rows={10}
                  className="font-mono text-sm"
                  placeholder="Full scope / bullet point list from quote..."
                />
              ) : (
                <div className="rounded-md bg-muted/40 border p-3 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                  {form.fullDescription?.trim() || "No scope of work recorded."}
                </div>
              )}
            </section>
          </div>
        </ScrollArea>

        {editing && (
          <div className="flex items-center justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => { setEditing(false); setForm({ name: project.name, company: project.company, projectId: project.projectId, description: project.description ?? "", fullDescription: project.fullDescription ?? "", startDate: project.startDate ?? "", status: project.status, address: project.address ?? "", contactName: project.contactName ?? "", contactPhone: project.contactPhone ?? "", contactEmail: project.contactEmail ?? "", totalPrice: project.totalPrice ?? "" }); }}>
              <X className="w-4 h-4 mr-1.5" />
              Discard
            </Button>
            <Button onClick={() => updateMutation.mutate(form)} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-1.5" />}
              Save Changes
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── New Project Dialog ──────────────────────────────────────────────────────
function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsedTasks, setParsedTasks] = useState<ParsedTaskItem[]>([]);

  function clearForm() {
    setForm(EMPTY_FORM);
    setFile(null);
    setParsedTasks([]);
  }

  function handleClose(v: boolean) {
    if (!v) clearForm();
    onOpenChange(v);
  }

  const mutation = useMutation({
    mutationFn: (data: typeof form & { parsedTasks: ParsedTaskItem[] }) =>
      apiClient.post("/projects", data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project created" });
      clearForm();
      onOpenChange(false);
    },
    onError: () => toast({ title: "Failed to create project", variant: "destructive" }),
  });

  async function handlePdfParse() {
    if (!file) return;
    setParsing(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await apiClient.post("/projects/parse-pdf", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const data = r.data;
      setForm(prev => ({ ...prev, ...data }));
      setParsedTasks(data.parsedTasks ?? []);
      toast({ title: "PDF parsed", description: `${data.parsedTasks?.length ?? 0} tasks detected` });
    } catch {
      toast({ title: "Failed to parse PDF", variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5" />
            New Project
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="space-y-4 pt-2 pb-2">
            {/* PDF import */}
            <div className="flex items-center gap-2 p-3 rounded-lg border-2 border-dashed border-border bg-muted/30">
              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <input
                  type="file"
                  accept=".pdf"
                  className="w-full text-sm file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-primary file:text-primary-foreground cursor-pointer"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button size="sm" variant="outline" onClick={handlePdfParse} disabled={!file || parsing}>
                {parsing ? <Loader2 className="w-3 h-3 animate-spin" /> : "Parse PDF"}
              </Button>
            </div>

            {/* Parsed tasks preview */}
            {parsedTasks.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                  <FolderKanban className="w-3.5 h-3.5" />
                  {parsedTasks.length} tasks will be created in "New Tasks"
                </p>
                <ul className="space-y-1">
                  {parsedTasks.slice(0, 6).map((t, i) => (
                    <li key={i} className="text-xs text-amber-900 dark:text-amber-300 flex items-start gap-1.5">
                      <span className="mt-0.5 text-amber-500">•</span>
                      <span className="line-clamp-1">{t.title}</span>
                    </li>
                  ))}
                  {parsedTasks.length > 6 && (
                    <li className="text-xs text-amber-600 dark:text-amber-500 pl-3">
                      + {parsedTasks.length - 6} more...
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Project Name *</Label>
                <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Custom Welding Fixture" />
              </div>
              <div>
                <Label>Company</Label>
                <Input value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} placeholder="Acme Manufacturing Co." />
              </div>
              <div>
                <Label>Quote / Project ID</Label>
                <Input value={form.projectId} onChange={e => setForm(p => ({ ...p, projectId: e.target.value }))} placeholder="QT-2024-0042" />
              </div>
              <div className="col-span-2">
                <Label>Address</Label>
                <Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="742 Evergreen Terrace, Springfield, CA 90210" />
              </div>
              <div>
                <Label>Contact Name</Label>
                <Input value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))} placeholder="Jane Smith" />
              </div>
              <div>
                <Label>Contact Phone</Label>
                <Input value={form.contactPhone} onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))} placeholder="555-867-5309" />
              </div>
              <div>
                <Label>Contact Email</Label>
                <Input value={form.contactEmail} onChange={e => setForm(p => ({ ...p, contactEmail: e.target.value }))} placeholder="jsmith@acmemfg.com" />
              </div>
              <div>
                <Label>Total Price</Label>
                <Input value={form.totalPrice} onChange={e => setForm(p => ({ ...p, totalPrice: e.target.value }))} placeholder="$85,000.00" />
              </div>
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Brief Description</Label>
                <Textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="High-level description shown on project card..."
                  rows={2}
                />
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between pt-3 border-t">
          <Button variant="ghost" size="sm" onClick={clearForm} className="text-muted-foreground">
            <Eraser className="w-4 h-4 mr-1.5" />
            Clear
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate({ ...form, parsedTasks })}
              disabled={!form.name || mutation.isPending}
            >
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Project
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Projects Page ───────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [infoProject, setInfoProject] = useState<Project | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
  });

  const filtered = (projects as Project[]).filter(p =>
    [p.name, p.company, p.projectId].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground text-sm mt-1">{projects.length} total</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Project
        </Button>
      </div>

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search projects..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderKanban className="w-12 h-12 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No projects found</p>
          <Button className="mt-4" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create first project
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((project, i: number) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Card className="h-full hover:shadow-md transition-all hover:border-primary/50 group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <FolderKanban className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={e => { e.preventDefault(); e.stopPropagation(); setInfoProject(project); }}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="View project info"
                      >
                        <Info className="w-4 h-4" />
                      </button>
                      <Badge variant={STATUS_VARIANTS[project.status] ?? "secondary"} className="capitalize">
                        {project.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </div>

                  <Link href={`/projects/${project.id}`} className="block">
                    <h3 className="font-semibold line-clamp-2 mb-1 group-hover:text-primary transition-colors">
                      {project.name}
                    </h3>
                    <div className="space-y-1 mt-2">
                      {project.company && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Building2 className="w-3 h-3" />
                          <span className="truncate">{project.company}</span>
                        </div>
                      )}
                      {project.projectId && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <FileText className="w-3 h-3" />
                          <span>{project.projectId}</span>
                        </div>
                      )}
                      {project.startDate && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          <span>{format(new Date(project.startDate), "MMM d, yyyy")}</span>
                        </div>
                      )}
                      {project.totalPrice && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <DollarSign className="w-3 h-3" />
                          <span className="font-medium text-green-600 dark:text-green-400">{project.totalPrice}</span>
                        </div>
                      )}
                    </div>
                    {project.description && (
                      <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{project.description}</p>
                    )}
                    <div className="flex items-center justify-end mt-3">
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {infoProject && (
        <ProjectInfoDialog
          project={infoProject}
          onClose={() => setInfoProject(null)}
        />
      )}
    </div>
  );
}
