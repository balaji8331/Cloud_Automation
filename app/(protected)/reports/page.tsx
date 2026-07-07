"use client";
import { useState, useEffect } from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CostTrendChart } from "@/components/charts/CostTrendChart";
import { ServiceCostChart } from "@/components/charts/ServiceCostChart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useTenants } from "@/lib/context/TenantsContext";
import { formatCurrency } from "@/lib/utils";

type Range = "7d" | "30d" | "90d" | "1y";

interface DrilldownData {
  dailyCosts: { date: string; cost: number; currency: string }[];
  byService: { serviceName: string; totalCost: number }[];
  byResourceGroup: { resourceGroup: string; totalCost: number }[];
}

export default function ReportsPage() {
  const { toast } = useToast();
  const { tenants } = useTenants();
  const [range, setRange] = useState<Range>("30d");
  const [tenantId, setTenantId] = useState<string>("all");
  const [data, setData] = useState<DrilldownData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ range });
    if (tenantId !== "all") params.set("tenantId", tenantId);
    fetch(`/api/dashboard/drilldown?${params}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [range, tenantId]);

  async function exportCSV() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format: "csv", range });
      if (tenantId !== "all") params.set("tenantId", tenantId);
      const res = await fetch(`/api/reports/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `azure-costs-${range}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ variant: "success", title: "CSV exported" });
    } catch {
      toast({ variant: "destructive", title: "Export failed" });
    } finally {
      setExporting(false);
    }
  }

  async function exportPDF() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format: "json", range });
      if (tenantId !== "all") params.set("tenantId", tenantId);
      const res = await fetch(`/api/reports/export?${params}`);
      const { records } = await res.json();

      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;

      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(14);
      doc.text(`Azure Cost Report — ${range}`, 14, 16);
      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 24);

      autoTable(doc, {
        startY: 30,
        head: [["Date", "Tenant", "Subscription", "Resource Group", "Service", "Cost", "Currency"]],
        body: records.map((r: Record<string, unknown>) => [
          r.date, r.tenant, r.subscriptionName || r.subscriptionId,
          r.resourceGroup, r.serviceName,
          formatCurrency(Number(r.cost)), r.currency,
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235] },
      });

      doc.save(`azure-costs-${range}.pdf`);
      toast({ variant: "success", title: "PDF exported" });
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "PDF export failed" });
    } finally {
      setExporting(false);
    }
  }

  const totalCost = data?.dailyCosts.reduce((s, d) => s + d.cost, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Filters + Export */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={tenantId} onValueChange={setTenantId}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Tenants" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tenants</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={range} onValueChange={(v) => setRange(v as Range)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="1y">Last year</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={exportCSV} loading={exporting}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={exportPDF} loading={exporting}>
            <FileText className="h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 flex items-center gap-6">
        <div>
          <p className="text-xs text-gray-500">Total Spend ({range})</p>
          <p className="text-2xl font-semibold text-gray-900">
            {loading ? "—" : formatCurrency(totalCost)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Records</p>
          <p className="text-2xl font-semibold text-gray-900">
            {loading ? "—" : data?.dailyCosts.length ?? 0}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Daily Cost Trend</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[280px] flex items-center justify-center text-gray-400 text-sm">Loading…</div>
            ) : (
              <CostTrendChart data={data?.dailyCosts ?? []} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cost by Service</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">Loading…</div>
            ) : (
              <ServiceCostChart data={data?.byService ?? []} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Resource Group table */}
      {data?.byResourceGroup && data.byResourceGroup.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Cost by Resource Group</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="pb-2 font-medium text-gray-500 text-xs">Resource Group</th>
                  <th className="pb-2 font-medium text-gray-500 text-xs text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.byResourceGroup.slice(0, 20).map((rg) => (
                  <tr key={rg.resourceGroup}>
                    <td className="py-2 text-gray-700">{rg.resourceGroup}</td>
                    <td className="py-2 text-right font-medium">{formatCurrency(rg.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
