import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Eye, Copy, Info } from "lucide-react";
import { formatDate } from "@/lib/utils";

export function VmDetailSheet({ open, vm, onClose, onRefresh }: { open: boolean, vm: any, onClose: () => void, onRefresh?: () => void }) {
  const { toast } = useToast();
  const [password, setPassword] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [assigning, setAssigning] = useState(false);
  const [assignedTo, setAssignedTo] = useState("");
  const [trainingName, setTrainingName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [savingAssign, setSavingAssign] = useState(false);

  // Reset password state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setPassword(null);
    }
  }, [open]);

  if (!vm) return null;

  async function handleRevealPassword() {
    setLoading(true);
    try {
      const res = await fetch(`/api/vm-inventory/${vm.id}/reveal-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPassword(data.password);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Cannot reveal password", description: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    setSavingAssign(true);
    try {
      const res = await fetch(`/api/vm-inventory/${vm.id}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo, trainingName, startDate, endDate }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      toast({ variant: "success", title: "VM Assigned successfully" });
      setAssigning(false);
      setAssignedTo(""); setTrainingName(""); setStartDate(""); setEndDate("");
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Assignment failed", description: err.message });
    } finally {
      setSavingAssign(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{vm.name} Details</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500 mb-1">IP Address</p>
              <p className="font-medium">{vm.ipAddress}</p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">Config</p>
              <p className="font-medium">
                {vm.configPreset ? vm.configPreset.name : `Custom: ${vm.customVcpus}vCPU / ${vm.customRamGb}GB`}
              </p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">Billing</p>
              <p className="font-medium"><Badge variant="outline">{vm.billingType}</Badge></p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">Admin Username</p>
              <p className="font-medium">{vm.username}</p>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded border">
            <p className="text-sm font-medium mb-2">Admin Password</p>
            {password ? (
              <div className="flex items-center gap-3">
                <code className="bg-white px-3 py-1.5 border rounded text-sm flex-1">{password}</code>
                <Button variant="outline" size="sm" onClick={() => {
                  navigator.clipboard.writeText(password);
                  toast({ variant: "success", title: "Copied to clipboard" });
                }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={handleRevealPassword} loading={loading}>
                <Eye className="h-4 w-4 mr-2" />
                Reveal Password
              </Button>
            )}
            <p className="text-xs text-gray-400 mt-2">Revealing the password is logged to the audit trail.</p>
          </div>

          <div className="bg-gray-50 p-4 rounded border">
            <div className="flex items-center gap-1 mb-2">
              <p className="text-sm font-medium">Guacamole Access</p>
              <div className="group relative cursor-help">
                <Info className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 bg-gray-900 text-white text-xs rounded p-2 hidden group-hover:block z-10 normal-case font-normal shadow-lg">
                  Guacamole Access shows who currently has login permission to this VM via the remote desktop gateway (synced from Guacamole automatically). Training Assignment is this portal's own booking record for planning.
                </div>
              </div>
            </div>
            {vm.guacamoleAccessSyncs && vm.guacamoleAccessSyncs.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {vm.guacamoleAccessSyncs.map((sync: any) => (
                  <Badge key={sync.id} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    {sync.guacamoleUsername} ({sync.guacamoleConnectionName})
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">No Guacamole connection found for this IP.</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between border-b pb-2 mb-3">
              <h4 className="font-medium text-sm">Booking History (Current Search Range)</h4>
              <Button variant="outline" size="sm" onClick={() => setAssigning(!assigning)}>
                {assigning ? "Cancel" : "Book VM"}
              </Button>
            </div>
            
            {assigning && (
              <form onSubmit={handleAssign} className="mb-4 bg-blue-50/50 p-4 rounded-md border border-blue-100 space-y-3">
                <h5 className="text-sm font-medium text-blue-900">New Booking</h5>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Assign To" value={assignedTo} onChange={e => setAssignedTo(e.target.value)} required placeholder="e.g. John Doe" />
                  <Input label="Training/Project Name" value={trainingName} onChange={e => setTrainingName(e.target.value)} placeholder="e.g. Onboarding Q3" />
                  <Input label="Start Date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
                  <Input label="End Date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
                </div>
                <Button type="submit" size="sm" loading={savingAssign}>Confirm Booking</Button>
              </form>
            )}

            {vm.assignments?.length > 0 ? (
              <ul className="space-y-2">
                {vm.assignments.map((a: any) => (
                  <li key={a.id} className="text-sm p-3 bg-blue-50/50 rounded border border-blue-100 flex justify-between items-center">
                    <div>
                      <p className="font-medium text-blue-900">{a.assignedTo}</p>
                      {a.trainingName && <p className="text-xs text-blue-700">{a.trainingName}</p>}
                    </div>
                    <div className="text-right text-xs text-blue-800">
                      <p>{formatDate(a.startDate)}</p>
                      <p>to {formatDate(a.endDate)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500 italic">No assignments in this period.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
