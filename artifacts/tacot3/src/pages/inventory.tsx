import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { AlertTriangle, Plus, Search, Pencil, X, Check, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { Project } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────
interface InventoryItem {
  id: number;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  unitCost: string | null;
  supplier: string | null;
  location: string | null;
  minQty: number;
  notes: string | null;
  allocatedQty: number;
  availableQty: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isLow(item: InventoryItem) {
  return item.availableQty <= item.minQty && item.minQty > 0;
}

function fmtCost(v: string | null) {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return `$${n.toFixed(2)}`;
}

// ── Allocate Dialog ───────────────────────────────────────────────────────────
function AllocateDialog({
  item,
  open,
  onClose,
}: {
  item: InventoryItem;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [qty, setQty] = useState(1);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: () => apiClient.get("/projects").then(r => r.data),
    enabled: open,
  });

  const allocateMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/inventory/${item.id}/allocate`, {
        projectId: selectedProject!.id,
        quantity: qty,
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["project-inventory"] });
      toast({ title: "Allocated", description: `${qty} ${item.unit} of "${item.name}" allocated to "${selectedProject!.name}"` });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to allocate";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.company ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const maxQty = item.availableQty;

  function handleQtyChange(val: number) {
    setQty(Math.max(1, Math.min(maxQty, val)));
  }

  // Reset on open
  useEffect(() => {
    if (open) { setSearch(""); setSelectedProject(null); setQty(1); }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Allocate to Project</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Search for a project, then set the quantity of{" "}
          <span className="font-semibold text-foreground">{item.name}</span> to allocate.
        </p>
        <p className="text-xs text-muted-foreground">
          Available: <span className="font-medium">{maxQty} {item.unit}</span>
        </p>

        {/* Project search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Project list */}
        <div className="border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No projects found</p>
          ) : (
            filtered.map(p => (
              <button
                key={p.id}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted transition-colors border-b last:border-b-0 ${
                  selectedProject?.id === p.id ? "bg-primary/10 border-l-2 border-l-primary" : ""
                }`}
                onClick={() => setSelectedProject(p)}
              >
                <span className="text-left font-medium truncate">{p.name}</span>
                <Badge variant={p.status === "active" ? "default" : "secondary"} className="ml-2 flex-shrink-0 text-xs capitalize">
                  {p.status.replace("_", " ")}
                </Badge>
              </button>
            ))
          )}
        </div>

        {/* Quantity row (only when project selected) */}
        {selectedProject && (
          <div className="flex items-center gap-3 pt-1">
            <Label className="text-sm font-medium whitespace-nowrap">
              Quantity ({item.unit})
            </Label>
            <div className="flex items-center border rounded-md overflow-hidden">
              <button
                className="px-2 py-1.5 hover:bg-muted transition-colors border-r"
                onClick={() => handleQtyChange(qty - 1)}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
              <input
                type="number"
                min={1}
                max={maxQty}
                value={qty}
                onChange={e => handleQtyChange(Number(e.target.value))}
                className="w-16 text-center bg-transparent py-1.5 text-sm font-semibold focus:outline-none"
              />
              <button
                className="px-2 py-1.5 hover:bg-muted transition-colors border-l"
                onClick={() => handleQtyChange(qty + 1)}
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>
            <Button
              size="sm"
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => allocateMutation.mutate()}
              disabled={allocateMutation.isPending}
            >
              {allocateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "OK"}
            </Button>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Item Detail Dialog ────────────────────────────────────────────────────────
const FIELD_DEFS = [
  { key: "sku", label: "SKU", required: true },
  { key: "name", label: "Name", required: true },
  { key: "category", label: "Category" },
  { key: "quantity", label: "Quantity (total stock)", type: "number" },
  { key: "unit", label: "Unit (ea, stick, spool…)" },
  { key: "unitCost", label: "Unit Cost ($)" },
  { key: "supplier", label: "Supplier" },
  { key: "location", label: "Storage Location" },
  { key: "minQty", label: "Min Qty (low-stock threshold)", type: "number" },
  { key: "notes", label: "Notes", multiline: true },
] as const;

type FieldKey = typeof FIELD_DEFS[number]["key"];

function ItemDetailDialog({
  item,
  open,
  onClose,
  onAllocate,
}: {
  item: InventoryItem | null;
  open: boolean;
  onClose: () => void;
  onAllocate: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (item) {
      setForm({
        sku: item.sku,
        name: item.name,
        category: item.category,
        quantity: String(item.quantity),
        unit: item.unit,
        unitCost: item.unitCost ?? "",
        supplier: item.supplier ?? "",
        location: item.location ?? "",
        minQty: String(item.minQty),
        notes: item.notes ?? "",
      });
      setEditing(false);
    }
  }, [item, open]);

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/inventory/${item!.id}`, {
        sku: form.sku,
        name: form.name,
        category: form.category,
        quantity: parseFloat(form.quantity) || 0,
        unit: form.unit,
        unitCost: form.unitCost || null,
        supplier: form.supplier || null,
        location: form.location || null,
        minQty: parseFloat(form.minQty) || 0,
        notes: form.notes || null,
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast({ title: "Item updated" });
      setEditing(false);
    },
    onError: () => toast({ title: "Failed to update item", variant: "destructive" }),
  });

  if (!item) return null;

  const low = isLow(item);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="flex-1 text-lg">{item.name}</DialogTitle>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Edit item"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">{item.sku}</p>
        </DialogHeader>

        {/* Stock summary */}
        <div className="grid grid-cols-3 gap-3 text-center py-2">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xl font-bold">{item.quantity}</p>
            <p className="text-xs text-muted-foreground">Total Stock</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-xl font-bold text-orange-500">{item.allocatedQty}</p>
            <p className="text-xs text-muted-foreground">Allocated</p>
          </div>
          <div className={`rounded-lg p-3 ${low ? "bg-red-500/10" : "bg-green-500/10"}`}>
            <p className={`text-xl font-bold ${low ? "text-red-500" : "text-green-500"}`}>{item.availableQty}</p>
            <p className="text-xs text-muted-foreground">Available</p>
          </div>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          {FIELD_DEFS.map(f => (
            <div key={f.key}>
              <Label className="text-xs text-muted-foreground">{f.label}</Label>
              {editing ? (
                f.multiline ? (
                  <textarea
                    className="w-full mt-1 text-sm border rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                    rows={3}
                    value={form[f.key] ?? ""}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  />
                ) : (
                  <Input
                    className="mt-1 h-8 text-sm"
                    type={(f as { type?: string }).type ?? "text"}
                    value={form[f.key] ?? ""}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  />
                )
              ) : (
                <p className="text-sm mt-0.5 font-medium">
                  {f.key === "unitCost" ? fmtCost(form[f.key] ?? null) : form[f.key] || "—"}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t mt-2">
          <Button
            size="sm"
            className="bg-amber-500 hover:bg-amber-600 text-white"
            onClick={() => { onClose(); setTimeout(onAllocate, 100); }}
          >
            Allocate
          </Button>
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                  Save
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── New Item Dialog ───────────────────────────────────────────────────────────
function NewItemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    sku: "", name: "", category: "General", quantity: "0", unit: "ea",
    unitCost: "", supplier: "", location: "", minQty: "0", notes: "",
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post("/inventory", {
        sku: form.sku,
        name: form.name,
        category: form.category,
        quantity: parseFloat(form.quantity) || 0,
        unit: form.unit,
        unitCost: form.unitCost || null,
        supplier: form.supplier || null,
        location: form.location || null,
        minQty: parseFloat(form.minQty) || 0,
        notes: form.notes || null,
      }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast({ title: "Item created" });
      onClose();
    },
    onError: () => toast({ title: "Failed to create item", variant: "destructive" }),
  });

  useEffect(() => {
    if (open) setForm({ sku: "", name: "", category: "General", quantity: "0", unit: "ea", unitCost: "", supplier: "", location: "", minQty: "0", notes: "" });
  }, [open]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Inventory Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {FIELD_DEFS.map(f => (
            <div key={f.key}>
              <Label className="text-xs text-muted-foreground">
                {f.label}{(f as { required?: boolean }).required && <span className="text-red-500 ml-0.5">*</span>}
              </Label>
              {f.multiline ? (
                <textarea
                  className="w-full mt-1 text-sm border rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={3}
                  value={form[f.key as keyof typeof form]}
                  onChange={set(f.key)}
                />
              ) : (
                <Input
                  className="mt-1 h-8 text-sm"
                  type={(f as { type?: string }).type ?? "text"}
                  value={form[f.key as keyof typeof form]}
                  onChange={set(f.key)}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t mt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={!form.sku.trim() || !form.name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Create Item
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const { data: items = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ["inventory"],
    queryFn: () => apiClient.get("/inventory").then(r => r.data),
  });

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.sku.toLowerCase().includes(search.toLowerCase()) ||
    i.category.toLowerCase().includes(search.toLowerCase()) ||
    (i.supplier ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function openItem(item: InventoryItem) {
    setSelectedItem(item);
    setDetailOpen(true);
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Click any item to view details or allocate to a project.</p>
        </div>
        <Button className="gap-2 bg-amber-500 hover:bg-amber-600 text-white" onClick={() => setNewOpen(true)}>
          <Plus className="w-4 h-4" />
          New Item
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search projects, tasks, or SKUs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">SKU</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Category</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Quantity</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Unit Cost</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Supplier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="text-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-muted-foreground text-sm">
                  {items.length === 0 ? "No inventory items yet. Add your first item." : "No items match your search."}
                </td>
              </tr>
            ) : (
              filtered.map(item => {
                const low = isLow(item);
                return (
                  <tr
                    key={item.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => openItem(item)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.sku}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {low && <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" title="Low stock" />}
                        <span className={`font-medium ${low ? "text-amber-500" : ""}`}>{item.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{item.category}</td>
                    <td className="px-4 py-3">
                      <span className={`font-semibold ${low ? "text-amber-500" : ""}`}>
                        {item.availableQty}
                      </span>
                      {item.allocatedQty > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">({item.allocatedQty} alloc.)</span>
                      )}
                      <span className="text-muted-foreground ml-1 text-xs">{item.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{fmtCost(item.unitCost)}</td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{item.supplier ?? "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <ItemDetailDialog
        item={selectedItem}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onAllocate={() => {
          setAllocateOpen(true);
        }}
      />

      {selectedItem && (
        <AllocateDialog
          item={selectedItem}
          open={allocateOpen}
          onClose={() => setAllocateOpen(false)}
        />
      )}

      <NewItemDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
