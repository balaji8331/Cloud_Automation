"use client";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

export function AddVmDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [presets, setPresets] = useState<any[]>([]);

  // Form state
  const [name, setName] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [username, setUsername] = useState("Administrator");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Active");
  const [configPresetId, setConfigPresetId] = useState<string>("CUSTOM");
  
  const [customVcpus, setCustomVcpus] = useState("");
  const [customRamGb, setCustomRamGb] = useState("");
  const [customDiskGb, setCustomDiskGb] = useState("");
  
  const [billingType, setBillingType] = useState<"HOURLY" | "MONTHLY" | "QUARTERLY">("MONTHLY");
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetch("/api/vm-config-presets").then(r => r.json()).then(data => setPresets(data)).catch(() => {});
      // Reset form
      setName(""); setIpAddress(""); setUsername("Administrator"); setPassword("");
      setStatus("Active");
      setConfigPresetId("CUSTOM"); setCustomVcpus(""); setCustomRamGb(""); setCustomDiskGb("");
      setBillingType("MONTHLY"); setRate(""); setNotes("");
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: any = {
        name,
        ipAddress,
        username,
        password: password || "ChangeMe123!",
        status,
        billingType,
        notes
      };
      
      if (configPresetId !== "CUSTOM") {
        payload.configPresetId = configPresetId;
      } else {
        payload.customVcpus = parseInt(customVcpus, 10);
        payload.customRamGb = parseInt(customRamGb, 10);
        payload.customDiskGb = parseInt(customDiskGb, 10);
      }

      const numRate = parseFloat(rate);
      if (!isNaN(numRate)) {
        if (billingType === "HOURLY") payload.hourlyRate = numRate;
        if (billingType === "MONTHLY") payload.monthlyRate = numRate;
        if (billingType === "QUARTERLY") payload.quarterlyRate = numRate;
      }

      const res = await fetch("/api/vm-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        const err = await res.json();
        toast({ variant: "destructive", title: "Failed to add VM", description: err.error });
      } else {
        toast({ variant: "success", title: "VM added to inventory" });
        onSaved();
      }
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add VM to Inventory</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
          <div className="grid grid-cols-2 gap-4">
            <Input label="VM Name" value={name} onChange={e => setName(e.target.value)} required />
            <Input label="IP Address" value={ipAddress} onChange={e => setIpAddress(e.target.value)} required />
            <Input label="Admin Username" value={username} onChange={e => setUsername(e.target.value)} required />
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave blank for ChangeMe123!" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <select 
                value={status} 
                onChange={e => setStatus(e.target.value)}
                className="w-full border border-gray-300 rounded-md text-sm px-3 py-2 bg-white"
              >
                <option value="Active">Active</option>
                <option value="Passive">Passive</option>
              </select>
            </div>
          </div>

          <div className="pt-2">
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Config Preset</label>
            <Select value={configPresetId} onValueChange={setConfigPresetId}>
              <SelectTrigger>
                <SelectValue placeholder="Select config" />
              </SelectTrigger>
              <SelectContent>
                {presets.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
                <SelectItem value="CUSTOM">Custom Specification...</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {configPresetId === "CUSTOM" && (
            <div className="grid grid-cols-3 gap-4 bg-gray-50 p-4 rounded-md border border-gray-100">
              <Input label="vCPUs" type="number" min="1" value={customVcpus} onChange={e => setCustomVcpus(e.target.value)} required />
              <Input label="RAM (GB)" type="number" min="1" value={customRamGb} onChange={e => setCustomRamGb(e.target.value)} required />
              <Input label="Disk (GB)" type="number" min="1" value={customDiskGb} onChange={e => setCustomDiskGb(e.target.value)} required />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Billing Type</label>
              <Select value={billingType} onValueChange={(v: any) => setBillingType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOURLY">Hourly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input label={`${billingType.charAt(0) + billingType.slice(1).toLowerCase()} Rate ($)`} type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} />
          </div>

          <div className="pt-2">
            <Input label="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>Add VM</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
