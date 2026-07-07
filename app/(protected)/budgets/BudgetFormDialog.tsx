"use client";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

interface Tenant { id: string; name: string; }
interface BudgetRow {
  id: string; name: string; amount: number; timeGrain: string;
  startDate: string; endDate: string | null; alertThreshold: number;
  tenantId: string; subscriptionId: string | null;
  scopeType: string; scopeId: string | null; source: string;
}

interface Subscription { id: string; subscriptionId: string; subscriptionName: string | null; }

export function BudgetFormDialog({ open, budget, tenants, onClose, onSaved }: {
  open: boolean; budget: BudgetRow | null; tenants: Tenant[];
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!budget;
  const [tenantId, setTenantId] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [timeGrain, setTimeGrain] = useState("MONTHLY");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [alertThreshold, setAlertThreshold] = useState("80");
  const [scopeType, setScopeType] = useState("TENANT");
  const [scopeId, setScopeId] = useState("");
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (budget) {
      setTenantId(budget.tenantId); setName(budget.name);
      setAmount(String(budget.amount)); setTimeGrain(budget.timeGrain);
      setStartDate(budget.startDate.split("T")[0]);
      setEndDate(budget.endDate ? budget.endDate.split("T")[0] : "");
      setAlertThreshold(String(Number(budget.alertThreshold) * 100));
      setScopeType(budget.scopeType); setScopeId(budget.scopeId ?? "");
    } else {
      setTenantId(tenants[0]?.id ?? ""); setName(""); setAmount("");
      setTimeGrain("MONTHLY"); setStartDate(new Date().toISOString().split("T")[0]);
      setEndDate(""); setAlertThreshold("80"); setScopeType("TENANT"); setScopeId("");
    }
  }, [budget, open, tenants]);

  // Load subscriptions when tenant changes
  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/tenants/${tenantId}`)
      .then((r) => r.json())
      .then((d) => setSubscriptions(d.subscriptions ?? []))
      .catch(console.error);
  }, [tenantId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const body = {
      tenantId, name, amount: Number(amount), timeGrain, startDate,
      endDate: endDate || undefined,
      alertThreshold: Number(alertThreshold) / 100,
      scopeType, scopeId: scopeId || undefined,
    };
    const url = isEdit ? `/api/budgets/${budget.id}` : "/api/budgets";
    const method = isEdit ? "PATCH" : "POST";
    try {
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast({ variant: "destructive", title: "Save failed", description: JSON.stringify(data.error) }); return; }
      toast({ variant: "success", title: isEdit ? "Budget updated" : "Budget created" });
      onSaved();
    } catch { toast({ variant: "destructive", title: "Network error" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Budget" : "Create Budget"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tenant */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Tenant</label>
            <Select value={tenantId} onValueChange={setTenantId} disabled={isEdit}>
              <SelectTrigger><SelectValue placeholder="Select tenant" /></SelectTrigger>
              <SelectContent>
                {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Scope */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Scope</label>
              <Select value={scopeType} onValueChange={(v) => { setScopeType(v); setScopeId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TENANT">Tenant-wide</SelectItem>
                  <SelectItem value="SUBSCRIPTION">Subscription</SelectItem>
                  <SelectItem value="RESOURCE_GROUP">Resource Group</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scopeType === "SUBSCRIPTION" && (
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Subscription</label>
                <Select value={scopeId} onValueChange={setScopeId}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {subscriptions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.subscriptionName ?? s.subscriptionId.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {scopeType === "RESOURCE_GROUP" && (
              <Input label="Resource Group Name" value={scopeId} onChange={(e) => setScopeId(e.target.value)}
                placeholder="my-resource-group" />
            )}
          </div>

          <Input label="Budget Name" value={name} onChange={(e) => setName(e.target.value)} required />

          <div className="grid grid-cols-2 gap-3">
            <Input label="Amount (USD)" type="number" value={amount}
              onChange={(e) => setAmount(e.target.value)} min="0" step="0.01" required />
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Time Grain</label>
              <Select value={timeGrain} onValueChange={setTimeGrain}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                  <SelectItem value="ANNUALLY">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Date" type="date" value={startDate}
              onChange={(e) => setStartDate(e.target.value)} required />
            <Input label="End Date (optional)" type="date" value={endDate}
              onChange={(e) => setEndDate(e.target.value)} />
          </div>

          <Input label="Alert Threshold (%)" type="number" value={alertThreshold}
            onChange={(e) => setAlertThreshold(e.target.value)} min="1" max="100" />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>{isEdit ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
