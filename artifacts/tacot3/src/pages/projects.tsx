import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import type { Project, Department } from "@/lib/types";
import {
  Plus, FolderKanban, FileText, Search, Loader2, ChevronRight,
  Building2, Calendar, Eraser, Info, DollarSign,
  ChevronUp, ChevronDown, Minus, Zap, X, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { cn, formatQuoteNum } from "@/lib/utils";
import ProjectInfoDialog from "@/components/projects/ProjectInfoDialog";
import { computePhaseWindows } from "@/lib/schedule";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  on_hold: "outline",
  cancelled: "destructive",
};

const PRIORITY_ORDER = ["low", "medium", "high", "urgent"] as const;
type Priority = (typeof PRIORITY_ORDER)[number];
const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low", medium: "Medium", high: "High", urgent: "Urgent",
};
const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#3b82f6", medium: "#eab308", high: "#f97316", urgent: "#ef4444",
};
const PRIORITY_ICONS: Record<Priority, React.ElementType> = {
  low: ChevronDown, medium: Minus, high: ChevronUp, urgent: Zap,
};

const EMPTY_FORM = {
  name: "", company: "", projectId: "", description: "", fullDescription: "",
  startDate: "", status: "active", address: "", contactName: "",
  contactPhone: "", contactEmail: "", totalPrice: "",
  deliveryDate: "", scopeOfWork: "",
};

interface TemplateTask {
  id: number;
  title: string;
  sortOrder: number;
  departmentId: number;
  createdAt: string;
}

// ── New Project Dialog ──────────────────────────────────────────────────────
function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (projectId: number, hasTasks: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [expandedDepts, setExpandedDepts] = useState<Set<number>>(new Set());

  const { data: settings = {} } = useQuery<Record<string, string>>({
    queryKey: ["settings"],
    queryFn: () => apiClient.get("/settings").then(r => r.data),
    enabled: open,
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["departments", "global"],
    queryFn: () => apiClient.get("/departments?global=true").then(r => r.data),
    enabled: open,
  });

  const { data: templates = [] } = useQuery<TemplateTask[]>({
    queryKey: ["task-templates"],
    queryFn: () => apiClient.get("/task-templates").then(r => r.data),
    enabled: open,
  });

  const autoPopulate = settings["auto_populate_tasks"] !== "false";

  // Group templates by departmentId
  const templatesByDept = new Map<number, TemplateTask[]>();
  for (const t of templates) {
    if (!templatesByDept.has(t.departmentId)) templatesByDept.set(t.departmentId, []);
    templatesByDept.get(t.departmentId)!.push(t);
  }

  function clearForm() {
    setForm(EMPTY_FORM);
    setFile(null);
    setStep(1);
    setSelectedTaskIds(new Set());
    setExpandedDepts(new Set());
  }

  function handleClose(v: boolean) {
    if (!v) clearForm();
    onOpenChange(v);
  }

  function initStep2() {
    // Pre-select all tasks
    setSelectedTaskIds(new Set(templates.map(t => t.id)));
    // Expand all departments
    setExpandedDepts(new Set(departments.map(d => d.id)));
    setStep(2);
  }

  function toggleTask(id: number) {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleDept(deptId: number) {
    const deptTaskIds = (templatesByDept.get(deptId) ?? []).map(t => t.id);
    const allSelected = deptTaskIds.every(id => selectedTaskIds.has(id));
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        deptTaskIds.forEach(id => next.delete(id));
      } else {
        deptTaskIds.forEach(id => next.add(id));
      }
      return next;
    });
  }

  function toggleExpandDept(deptId: number) {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }

  const mutation = useMutation({
    mutationFn: (payload: typeof form & { selectedTaskIds?: number[] }) =>
      apiClient.post("/projects", payload).then(r => r.data),
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ["projects"] });

      if (file && file.type === "application/pdf") {
        try {
          const urlRes = await apiClient.post("/storage/uploads/request-url", {
            name: file.name,
            size: file.size,
            contentType: "application/pdf",
          });
          const { uploadURL, objectPath } = urlRes.data;
          const putRes = await fetch(uploadURL, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": "application/pdf" },
          });
          if (putRes.ok) {
            await apiClient.post(`/projects/${data.id}/attachments`, {
              fileName: file.name,
              objectPath,
              fileSize: file.size,
              mimeType: "application/pdf",
              isPinned: true,
            });
          }
        } catch {
          // Non-critical — project still created, skip attachment
        }
      }

      toast({ title: "Project created" });
      clearForm();
      onOpenChange(false);
      onCreated?.(data.id, true);
    },
    onError: () => toast({ title: "Failed to create project", variant: "destructive" }),
  });

  function handleSubmit() {
    if (autoPopulate) {
      mutation.mutate({ ...form });
    } else {
      mutation.mutate({ ...form, selectedTaskIds: Array.from(selectedTaskIds) });
    }
  }

  async function handlePdfParse() {
    if (!file) return;
    setParsing(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await apiClient.post("/projects/parse-pdf", fd);
      const data = r.data;
      setForm(prev => ({
        ...prev,
        ...data,
        projectId: data.projectId ? formatQuoteNum(data.projectId) : prev.projectId,
      }));
      toast({ title: "PDF parsed", description: "Project details filled in from document." });
    } catch {
      toast({ title: "Failed to parse PDF", variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5" />
            {step === 1 ? "New Project" : "Select Tasks"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <>
            <DialogBody className="-mx-1 px-1">
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

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="col-span-full">
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
                  <div className="col-span-full">
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
                    <Label>Delivery Date</Label>
                    <Input type="date" value={form.deliveryDate} onChange={e => setForm(p => ({ ...p, deliveryDate: e.target.value }))} />
                  </div>
                  {form.startDate && form.deliveryDate && (() => {
                    // Read-only phase preview. Uses the same 25%/30% lead-time
                    // split the server applies on create, so what the user
                    // sees here is exactly what gets persisted.
                    const w = computePhaseWindows(form.startDate, form.deliveryDate);
                    if (!w.engineering.startDate) {
                      return (
                        <div className="col-span-full rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                          Delivery date must be after start date to compute phase windows.
                        </div>
                      );
                    }
                    return (
                      <div className="col-span-full rounded-md border bg-muted/40 p-2 text-xs space-y-1">
                        <div className="font-medium text-foreground">Phase preview</div>
                        <div>
                          <span className="text-muted-foreground">Engineering (25%):</span>{" "}
                          {w.engineering.startDate} → {w.engineering.endDate} ({w.engineering.weeks} wk)
                        </div>
                        <div>
                          <span className="text-muted-foreground">Manufacturing (30%):</span>{" "}
                          {w.manufacturing.startDate} → {w.manufacturing.endDate} ({w.manufacturing.weeks} wk)
                        </div>
                      </div>
                    );
                  })()}
                  <div className="col-span-full">
                    <Label>Brief Description</Label>
                    <Textarea
                      value={form.description}
                      onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="High-level description shown on project card..."
                      rows={2}
                    />
                  </div>
                  <div className="col-span-full">
                    <Label>Scope of Work</Label>
                    <Textarea
                      value={form.scopeOfWork}
                      onChange={e => setForm(p => ({ ...p, scopeOfWork: e.target.value }))}
                      placeholder="Detailed scope parsed from the quote (line items, bullet points)..."
                      rows={4}
                    />
                  </div>
                </div>
              </div>
            </DialogBody>

            <DialogFooter className="flex flex-row items-center justify-between pt-3 border-t sm:justify-between sm:space-x-0">
              <Button variant="ghost" size="sm" onClick={clearForm} className="text-muted-foreground">
                <Eraser className="w-4 h-4 mr-1.5" />
                Clear
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                {autoPopulate ? (
                  <Button
                    onClick={handleSubmit}
                    disabled={!form.name || mutation.isPending}
                  >
                    {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Create Project
                  </Button>
                ) : (
                  <Button
                    onClick={initStep2}
                    disabled={!form.name}
                  >
                    Select Tasks
                    <ChevronRight className="w-4 h-4 ml-1.5" />
                  </Button>
                )}
              </div>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody className="-mx-1 px-1">
              <div className="text-xs text-muted-foreground pb-1">
                Choose which tasks to create for this project. All tasks are pre-selected.
              </div>
              <div className="space-y-2 pt-1 pb-2">
                {departments.map(dept => {
                  const deptTasks = templatesByDept.get(dept.id) ?? [];
                  if (deptTasks.length === 0) return null;
                  const allChecked = deptTasks.every(t => selectedTaskIds.has(t.id));
                  const someChecked = deptTasks.some(t => selectedTaskIds.has(t.id));
                  const isExpanded = expandedDepts.has(dept.id);

                  return (
                    <div key={dept.id} className="rounded-lg border overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/40">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                          onChange={() => toggleDept(dept.id)}
                          className="h-4 w-4 rounded border-border cursor-pointer"
                        />
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: dept.color ?? "#64748b" }}
                        />
                        <span className="text-sm font-semibold flex-1">{dept.name}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 mr-1">
                          {deptTasks.filter(t => selectedTaskIds.has(t.id)).length}/{deptTasks.length}
                        </Badge>
                        <button
                          onClick={() => toggleExpandDept(dept.id)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ChevronRight className={cn("w-4 h-4 transition-transform", isExpanded && "rotate-90")} />
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="divide-y divide-border">
                          {deptTasks.map(task => (
                            <label
                              key={task.id}
                              className="flex items-center gap-3 px-4 py-2 hover:bg-muted/20 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedTaskIds.has(task.id)}
                                onChange={() => toggleTask(task.id)}
                                className="h-4 w-4 rounded border-border flex-shrink-0"
                              />
                              <span className="text-sm">{task.title}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </DialogBody>

            <DialogFooter className="flex flex-row items-center justify-between pt-3 border-t sm:justify-between sm:space-x-0">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="text-muted-foreground">
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                <Button
                  onClick={handleSubmit}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Create Project
                  {selectedTaskIds.size > 0 && (
                    <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1.5">
                      {selectedTaskIds.size} tasks
                    </Badge>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
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
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
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
                          <span>{formatQuoteNum(project.projectId)}</span>
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

      <NewProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => {}}
      />

      {infoProject && (
        <ProjectInfoDialog
          project={infoProject}
          onClose={() => setInfoProject(null)}
        />
      )}
    </div>
  );
}
