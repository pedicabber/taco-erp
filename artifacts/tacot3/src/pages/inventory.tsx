import { Package, Search, Plus, AlertTriangle, ArrowUpDown, Box, Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

const MOCK_ITEMS = [
  { id: 1, sku: "ELC-001", name: "Control Panel Assembly", category: "Electrical", qty: 12, minQty: 5, unit: "ea", location: "Shelf A-3", status: "ok" },
  { id: 2, sku: "ELC-045", name: "24VDC Power Supply", category: "Electrical", qty: 3, minQty: 10, unit: "ea", location: "Shelf A-1", status: "low" },
  { id: 3, sku: "MEC-012", name: "Stainless Steel Bolt M8x40", category: "Hardware", qty: 450, minQty: 100, unit: "pcs", location: "Bin B-12", status: "ok" },
  { id: 4, sku: "MEC-088", name: "Linear Actuator 12\"", category: "Mechanical", qty: 2, minQty: 4, unit: "ea", location: "Shelf C-2", status: "low" },
  { id: 5, sku: "PLC-007", name: "PLC Input Module", category: "Controls", qty: 0, minQty: 3, unit: "ea", location: "Cabinet D-1", status: "out" },
  { id: 6, sku: "CAB-033", name: "Cable Tray 3ft Section", category: "Infrastructure", qty: 28, minQty: 10, unit: "ea", location: "Rack E-4", status: "ok" },
  { id: 7, sku: "SEN-019", name: "Proximity Sensor NPN", category: "Sensors", qty: 7, minQty: 5, unit: "ea", location: "Shelf A-5", status: "ok" },
  { id: 8, sku: "HMI-002", name: "HMI Touch Panel 7\"", category: "Controls", qty: 1, minQty: 2, unit: "ea", location: "Cabinet D-2", status: "low" },
];

const STATUS_MAP = {
  ok: { label: "In Stock", variant: "default" as const, color: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30" },
  low: { label: "Low Stock", variant: "outline" as const, color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30" },
  out: { label: "Out of Stock", variant: "destructive" as const, color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30" },
};

export default function InventoryPage() {
  const totalItems = MOCK_ITEMS.length;
  const lowStock = MOCK_ITEMS.filter(i => i.status === "low").length;
  const outOfStock = MOCK_ITEMS.filter(i => i.status === "out").length;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" />
            Inventory
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Track parts, materials, and equipment</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Add Item
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { icon: Box, label: "Total SKUs", value: totalItems, color: "bg-blue-500" },
          { icon: Tag, label: "Categories", value: 6, color: "bg-purple-500" },
          { icon: AlertTriangle, label: "Low Stock", value: lowStock, color: "bg-yellow-500" },
          { icon: AlertTriangle, label: "Out of Stock", value: outOfStock, color: "bg-red-500" },
        ].map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">{s.label}</p>
                    <p className="text-3xl font-bold mt-1">{s.value}</p>
                  </div>
                  <div className={`p-2.5 rounded-lg ${s.color}`}>
                    <s.icon className="w-5 h-5 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Table */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className="text-base">Items</CardTitle>
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search by SKU or name..." className="pl-9 h-8 text-sm" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-y border-border">
                  <tr>
                    {["SKU", "Item Name", "Category", "Qty", "Min Qty", "Location", "Status"].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {h}
                          {["Qty", "Item Name"].includes(h) && <ArrowUpDown className="w-3 h-3 opacity-50" />}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {MOCK_ITEMS.map((item, i) => {
                    const s = STATUS_MAP[item.status as keyof typeof STATUS_MAP];
                    return (
                      <motion.tr
                        key={item.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 + i * 0.04 }}
                        className="hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.sku}</td>
                        <td className="px-4 py-3 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{item.category}</td>
                        <td className={`px-4 py-3 font-semibold ${item.status === "out" ? "text-red-500" : item.status === "low" ? "text-yellow-500" : ""}`}>
                          {item.qty} <span className="text-xs text-muted-foreground font-normal">{item.unit}</span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{item.minQty}</td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{item.location}</td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${s.color}`}>
                            {s.label}
                          </span>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <p className="text-xs text-muted-foreground text-center mt-4">
        Inventory management integration coming soon. Showing sample data.
      </p>
    </div>
  );
}
