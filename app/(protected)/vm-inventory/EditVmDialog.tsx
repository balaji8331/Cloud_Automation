"use client";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

export function EditVmDialog({ open, vm, onClose, onSaved }: { open: boolean; vm: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useState<any[]>([]);

  // Form state
  const [name, setName] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [configPresetId, setConfigPresetId] = useState<string>("CUSTOM");
  
  const [customVcpus, setCustomVcpus] = useState("");
  const [customRamGb, setCustomRamGb] = useState("");
  const [customDiskGb, setCustomDiskGb] = useState("");
  
  const [billingType, setBillingType] = useState("MONTHLY");
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open && vm) {
      fetch("/api/vm-config-presets").then(r => r.json()).then(data => setPresets(data)).catch(() => {});
      
      setName(vm.name || "");
      setIpAddress(vm.ipAddress || "");
      setConfigPresetId(vm.configPresetId || "CUSTOM");
      setCustomVcpus(vm.customVcpus ? String(vm.customVcpus) : "");
      setCustomRamGb(vm.customRamGb ? String(vm.customRamGb) : "");
      setCustomDiskGb(vm.customDiskGb ? String(vm.customDiskGb) : "");
      setBillingType(vm.billingType || "MONTHLY");
      setNotes(vm.notes || "");
      
      if (vm.billingType === "HOURLY" && vm.hourlyRate) setRate(String(vm.hourlyRate));
      else if (vm.billingType === "MONTHLY" && vm.monthlyRate) setRate(String(vm.monthlyRate));
      else if (vm.billingType === "QUARTERLY" && vm.quarterlyRate) setRate(String(vm.quarterlyRate));
      else setRate("");
    }
  }, [open, vm]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!vm) return;
    setLoading(true);

    const payload: any = {
      name,
      ipAddress,
      billingType,
    };

    if (configPresetId !== "CUSTOM") {
      payload.configPresetId = configPresetId;
    } else {
      payload.customVcpus = customVcpus ? parseInt(customVcpus) : null;
      payload.customRamGb = customRamGb ? parseInt(customRamGb) : null;
      payload.customDiskGb = customDiskGb ? parseInt(customDiskGb) : null;
    }

    if (rate) {
      const r = parseFloat(rate);
      if (billingType === "HOURLY") payload.hourlyRate = r;
      if (billingType === "MONTHLY") payload.monthlyRate = r;
      if (billingType === "QUARTERLY") payload.quarterlyRate = r;
    }

    if (notes) payload.notes = notes;

    try {
      const res = await fetch(`/api/vm-inventory/${vm.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update VM");
      }

      toast({ variant: "success", title: "VM updated" });
      onSaved();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit VM: {vm?.name}</DialogTitle>
          <DialogDescription>Update the details for this virtual machine.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-6 mt-2">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>VM Name <span className="text-red-500">*</span></Label>
              <Input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. jumpserver-01" />
            </div>
            <div className="space-y-2">
              <Label>IP Address <span className="text-red-500">*</span></Label>
              <Input required value={ipAddress} onChange={e => setIpAddress(e.target.value)} placeholder="10.0.0.5" />
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium text-sm">Specs Configuration</h4>
            <div className="space-y-2">
              <Label>Preset</Label>
              <select 
                value={configPresetId} 
                onChange={e => setConfigPresetId(e.target.value)}
                className="w-full border border-gray-300 rounded-md text-sm px-3 py-2 bg-white"
              >
                <option value="CUSTOM">Custom Configuration...</option>
                {presets.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.vcpus}vCPU, {p.ramGb}GB)</option>
                ))}
              </select>
            </div>
            {configPresetId === "CUSTOM" && (
              <div className="grid grid-cols-3 gap-3 bg-gray-50 p-3 rounded border">
                <Input type="number" label="vCPU" value={customVcpus} onChange={e => setCustomVcpus(e.target.value)} placeholder="4" />
                <Input type="number" label="RAM (GB)" value={customRamGb} onChange={e => setCustomRamGb(e.target.value)} placeholder="16" />
                <Input type="number" label="Disk (GB)" value={customDiskGb} onChange={e => setCustomDiskGb(e.target.value)} placeholder="128" />
              </div>
            )}
          </div>

          <div className="space-y-4 border-t pt-4">
            <h4 className="font-medium text-sm">Billing</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Billing Cycle</Label>
                <select 
                  value={billingType} 
                  onChange={e => setBillingType(e.target.value)}
                  className="w-full border border-gray-300 rounded-md text-sm px-3 py-2 bg-white"
                >
                  <option value="HOURLY">Hourly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                </select>
              </div>
              <Input type="number" step="0.01" label={`Rate (${billingType.toLowerCase()})`} value={rate} onChange={e => setRate(e.target.value)} placeholder="Optional" />
            </div>
            <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional context about billing or usage..." />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
