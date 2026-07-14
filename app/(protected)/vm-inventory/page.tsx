"use client";
import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Trash2, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { AddVmDialog } from "./AddVmDialog";
import { BulkAddCsvDialog } from "./BulkAddCsvDialog";
import { VmDetailSheet } from "./VmDetailSheet";
import { EditVmDialog } from "./EditVmDialog";

export default function VmInventoryPage() {
  const { toast } = useToast();
  const [vms, setVms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  
  const [filterQuery, setFilterQuery] = useState("");
  const [filterBilling, setFilterBilling] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [selectedVm, setSelectedVm] = useState<any>(null);
  
  const [editVm, setEditVm] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const fetchVms = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (startDate) query.append("startDate", startDate);
      if (endDate) query.append("endDate", endDate);
      
      const res = await fetch(`/api/vm-inventory?${query.toString()}`);
      if (res.ok) {
        setVms(await res.json());
      } else {
        toast({ variant: "destructive", title: "Failed to fetch VMs" });
      }
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setLoading(false);
    }
  }, [toast, startDate, endDate]);

  useEffect(() => {
    fetchVms();
  }, [fetchVms]);

  async function handleBulkDelete() {
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} VMs?`)) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/vm-inventory/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (res.ok) {
        toast({ variant: "success", title: "Deleted successfully" });
        setSelectedIds([]);
        fetchVms();
      } else {
        toast({ variant: "destructive", title: "Failed to delete" });
      }
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Manage VM Inventory and Training Allocations.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkDialogOpen(true)}>
            Bulk Add (CSV)
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add VM
          </Button>
        </div>
      </div>

      <Card className="bg-blue-50/50 border-blue-100">
        <CardContent className="p-4 flex items-end gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Check availability from</label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-white" />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700 block mb-1.5">to</label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-white" />
          </div>
          <div>
            <Button onClick={fetchVms} variant="default" className="w-full">
              <Search className="mr-2 h-4 w-4" />
              Check Dates
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>VM Inventory <span className="text-sm font-normal text-gray-500 ml-1">({vms.length})</span></CardTitle>
            {selectedIds.length > 0 && (
              <Button variant="destructive" size="sm" onClick={handleBulkDelete} loading={deleting}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete {selectedIds.length} Selected
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-4">
            <Input 
              placeholder="Search by name, IP, or assignee..." 
              value={filterQuery} 
              onChange={e => setFilterQuery(e.target.value)} 
              className="w-72" 
            />
            <select 
              value={filterBilling} 
              onChange={e => setFilterBilling(e.target.value)} 
              className="border border-gray-300 rounded-md text-sm px-3 py-2"
            >
              <option value="ALL">All Billing Types</option>
              <option value="HOURLY">Hourly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
            </select>
            <select 
              value={filterStatus} 
              onChange={e => setFilterStatus(e.target.value)} 
              className="border border-gray-300 rounded-md text-sm px-3 py-2"
            >
              <option value="ALL">All Statuses</option>
              <option value="AVAILABLE">Available</option>
              <option value="UNAVAILABLE">Unavailable / Assigned</option>
            </select>
          </div>
          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <th className="pb-3 pr-4 pl-3 w-8">
                      <input 
                        type="checkbox" 
                        checked={vms.length > 0 && selectedIds.length === vms.length}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds(vms.map(v => v.id));
                          else setSelectedIds([]);
                        }}
                      />
                    </th>
                    <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">VM / IP</th>
                    <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Config</th>
                    <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Billing</th>
                    <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Status</th>
                    <th className="pb-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vms.filter(vm => {
                    if (filterBilling !== "ALL" && vm.billingType !== filterBilling) return false;
                    const isAssigned = vm.assignments && vm.assignments.length > 0;
                    if (filterStatus === "AVAILABLE" && isAssigned) return false;
                    if (filterStatus === "UNAVAILABLE" && !isAssigned) return false;
                    if (filterQuery) {
                      const q = filterQuery.toLowerCase();
                      const matchName = vm.name.toLowerCase().includes(q) || vm.ipAddress.includes(q);
                      const matchAssignee = vm.assignments?.some((a: any) => a.assignedTo.toLowerCase().includes(q) || a.trainingName?.toLowerCase().includes(q));
                      if (!matchName && !matchAssignee) return false;
                    }
                    return true;
                  }).map((vm) => (
                    <tr key={vm.id}>
                      <td className="py-4 pr-4 pl-3">
                        <input 
                          type="checkbox" 
                          checked={selectedIds.includes(vm.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedIds([...selectedIds, vm.id]);
                            else setSelectedIds(selectedIds.filter(id => id !== vm.id));
                          }}
                        />
                      </td>
                      <td className="py-4 pr-4">
                        <p className="font-medium text-gray-900">{vm.name}</p>
                        <p className="text-xs text-gray-500">{vm.ipAddress}</p>
                      </td>
                      <td className="py-4 pr-4 text-xs text-gray-500">
                        {vm.configPreset ? (
                          <span>{vm.configPreset.name}</span>
                        ) : (
                          <span>Custom: {vm.customVcpus}vCPU / {vm.customRamGb}GB</span>
                        )}
                      </td>
                      <td className="py-4 pr-4">
                        <Badge variant="outline">{vm.billingType}</Badge>
                      </td>
                      <td className="py-4">
                        {vm.assignments && vm.assignments.length > 0 ? (
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant="warning">Unavailable</Badge>
                            {startDate && endDate && vm.assignments[0] && (
                              <span className="text-xs text-gray-500 block">
                                Assigned to {vm.assignments[0].assignedTo} 
                                <br />({formatDate(vm.assignments[0].startDate)} - {formatDate(vm.assignments[0].endDate)})
                              </span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="success">Available</Badge>
                        )}
                      </td>
                      <td className="py-4">
                        <div className="flex gap-2 items-center">
                          <Button variant="outline" size="sm" onClick={() => setSelectedVm(vm)}>Details</Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditVm(vm)}>
                            <Edit className="h-4 w-4 text-gray-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {vms.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-400 text-sm">No VMs found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AddVmDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => { setDialogOpen(false); fetchVms(); }}
      />
      <BulkAddCsvDialog
        open={bulkDialogOpen}
        onClose={() => setBulkDialogOpen(false)}
        onSaved={() => { setBulkDialogOpen(false); fetchVms(); }}
      />
      <VmDetailSheet
        open={!!selectedVm}
        vm={selectedVm}
        onClose={() => setSelectedVm(null)}
        onRefresh={fetchVms}
      />
      <EditVmDialog
        open={!!editVm}
        vm={editVm}
        onClose={() => setEditVm(null)}
        onSaved={() => { setEditVm(null); fetchVms(); }}
      />
    </div>
  );
}
