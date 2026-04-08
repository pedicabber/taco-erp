import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiClient } from "@/lib/apiClient";
import type { Project } from "@/lib/types";
import { Plus, FolderKanban, FileText, Search, Loader2, ChevronRight, Building2, Calendar } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { motion } from "framer-motion";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  completed: "secondary",
  on_hold: "outline",
  cancelled: "destructive",
};

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", company: "", projectId: "", description: "", startDate: "", status: "active" });
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: typeof form) => apiClient.post("/projects", data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast({ title: "Project created" });
      onOpenChange(false);
      setForm({ name: "", company: "", projectId: "", description: "", startDate: "", status: "active" });
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
      setForm(prev => ({ ...prev, ...r.data }));
      toast({ title: "PDF parsed successfully" });
    } catch {
      toast({ title: "Failed to parse PDF", variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5" />
            New Project
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Project Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Custom Welding Fixture" />
            </div>
            <div>
              <Label>Company</Label>
              <Input value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} placeholder="Customer name" />
            </div>
            <div>
              <Label>Project / Quote ID</Label>
              <Input value={form.projectId} onChange={e => setForm(p => ({ ...p, projectId: e.target.value }))} placeholder="Q-2024-001" />
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
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Project description..."
                rows={3}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={() => mutation.mutate(form)}
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

export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

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
              <Link href={`/projects/${project.id}`}>
                <Card className="h-full hover:shadow-md transition-all hover:border-primary/50 cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FolderKanban className="w-5 h-5 text-primary" />
                      </div>
                      <Badge variant={STATUS_VARIANTS[project.status] ?? "secondary"} className="capitalize">
                        {project.status.replace("_", " ")}
                      </Badge>
                    </div>
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
                    </div>
                    {project.description && (
                      <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{project.description}</p>
                    )}
                    <div className="flex items-center justify-end mt-3">
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
