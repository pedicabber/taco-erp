import { TrendingUp, Search, Plus, DollarSign, Users, Clock, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

const STAGES = ["Lead", "Qualified", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];

const STAGE_COLORS: Record<string, string> = {
  "Lead": "bg-slate-500/10 text-slate-500 border-slate-500/30",
  "Qualified": "bg-blue-500/10 text-blue-500 border-blue-500/30",
  "Proposal": "bg-purple-500/10 text-purple-500 border-purple-500/30",
  "Negotiation": "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  "Closed Won": "bg-green-500/10 text-green-600 border-green-500/30",
  "Closed Lost": "bg-red-500/10 text-red-500 border-red-500/30",
};

const MOCK_DEALS = [
  { id: 1, name: "Conveyor System Upgrade", company: "AcmeCo", value: 148000, stage: "Proposal", owner: "J. Ferris", closeDate: "May 15", probability: 65 },
  { id: 2, name: "PLC Control Panel Build", company: "TechFab", value: 72000, stage: "Negotiation", owner: "D. Frazier", closeDate: "Apr 30", probability: 80 },
  { id: 3, name: "HMI Integration Project", company: "Industron", value: 35000, stage: "Qualified", owner: "J. Frazier", closeDate: "Jun 1", probability: 40 },
  { id: 4, name: "Safety System Install", company: "SafeOps", value: 92500, stage: "Closed Won", owner: "J. Ferris", closeDate: "Apr 5", probability: 100 },
  { id: 5, name: "Robotics Line Expansion", company: "AutoMFG", value: 220000, stage: "Lead", owner: "D. Frazier", closeDate: "Jul 20", probability: 20 },
  { id: 6, name: "Electrical Panel Upgrade", company: "BuildRight", value: 54000, stage: "Closed Lost", owner: "J. Frazier", closeDate: "Mar 31", probability: 0 },
  { id: 7, name: "SCADA System Rollout", company: "DataDrive", value: 185000, stage: "Proposal", owner: "J. Ferris", closeDate: "Jun 15", probability: 55 },
  { id: 8, name: "Pneumatic System Design", company: "FlexMake", value: 41000, stage: "Qualified", owner: "D. Frazier", closeDate: "May 28", probability: 35 },
];

function fmtMoney(v: number) {
  return v >= 1000000
    ? `$${(v / 1000000).toFixed(1)}M`
    : v >= 1000
    ? `$${Math.round(v / 1000)}k`
    : `$${v}`;
}

export default function SalesPipelinePage() {
  const openDeals = MOCK_DEALS.filter(d => !d.stage.startsWith("Closed"));
  const pipelineValue = openDeals.reduce((s, d) => s + d.value * (d.probability / 100), 0);
  const totalValue = openDeals.reduce((s, d) => s + d.value, 0);
  const wonDeals = MOCK_DEALS.filter(d => d.stage === "Closed Won");
  const wonValue = wonDeals.reduce((s, d) => s + d.value, 0);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="w-6 h-6" />
            Sales Pipeline
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Track deals and revenue opportunities</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Add Deal
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { icon: DollarSign, label: "Pipeline Value", value: fmtMoney(totalValue), sub: "total open", color: "bg-blue-500" },
          { icon: TrendingUp, label: "Weighted Value", value: fmtMoney(pipelineValue), sub: "by probability", color: "bg-purple-500" },
          { icon: CheckCircle, label: "Won (YTD)", value: fmtMoney(wonValue), sub: `${wonDeals.length} deals`, color: "bg-green-500" },
          { icon: Users, label: "Open Deals", value: openDeals.length, sub: "in pipeline", color: "bg-orange-500" },
        ].map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground font-medium">{s.label}</p>
                    <p className="text-3xl font-bold mt-1">{s.value}</p>
                    {s.sub && <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>}
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

      {/* Stage funnel */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mb-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pipeline by Stage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {STAGES.slice(0, 5).map(stage => {
                const deals = MOCK_DEALS.filter(d => d.stage === stage);
                const val = deals.reduce((s, d) => s + d.value, 0);
                return (
                  <div key={stage} className="text-center">
                    <div className={`rounded-lg border px-2 py-3 mb-1.5 ${STAGE_COLORS[stage]}`}>
                      <p className="text-lg font-bold">{deals.length}</p>
                      <p className="text-[10px] font-medium leading-tight">{stage}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{fmtMoney(val)}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Deal list */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className="text-base">All Deals</CardTitle>
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search deals..." className="pl-9 h-8 text-sm" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-y border-border">
                  <tr>
                    {["Deal", "Company", "Value", "Stage", "Owner", "Close Date", "Probability"].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {MOCK_DEALS.map((deal, i) => (
                    <motion.tr
                      key={deal.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.35 + i * 0.04 }}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium">{deal.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{deal.company}</td>
                      <td className="px-4 py-3 font-semibold">{fmtMoney(deal.value)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STAGE_COLORS[deal.stage]}`}>
                          {deal.stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{deal.owner}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3" />
                          {deal.closeDate}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-muted rounded-full h-1.5 w-16">
                            <div
                              className="h-1.5 rounded-full bg-primary"
                              style={{ width: `${deal.probability}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-8">{deal.probability}%</span>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <p className="text-xs text-muted-foreground text-center mt-4">
        CRM integration coming soon. Showing sample data.
      </p>
    </div>
  );
}
