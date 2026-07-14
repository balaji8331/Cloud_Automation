"use client";
import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import Papa from "papaparse";

const TEMPLATE_CSV = `ipAddress,VM-Username,VM-Password,VM-AssignedTo,VM-StartDate,VM-EndDate,configPreset,customVcpus,customRamGb,customDiskGb,billingType
10.0.0.5,Administrator,SamplePass123!,John Doe,2024-01-01,2024-01-15,16GB / 4 vCPU / 200GB SSD,,,,MONTHLY`;

export function BulkAddCsvDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [presets, setPresets] = useState<any[]>([]);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setParsedRows([]);
      fetch("/api/vm-config-presets").then(r => r.json()).then(data => setPresets(data)).catch(() => {});
    }
  }, [open]);

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "vm_inventory_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        validateRows(results.data);
      },
      error: () => {
        toast({ variant: "destructive", title: "Failed to parse CSV" });
      }
    });
  }

  function validateRows(data: any[]) {
    const validated = data.map((row, index) => {
      const errors = [];
      const payload: any = {};

      if (!row.ipAddress) {
        errors.push("Missing ipAddress");
      } else {
        payload.ipAddress = row.ipAddress;
        payload.name = `VM-${row.ipAddress}`; // Auto-generated name for Prisma
      }

      if (!row["VM-Username"]) {
        payload.username = "Administrator";
      } else {
        payload.username = row["VM-Username"];
      }

      if (!row["VM-Password"]) errors.push("Missing VM-Password");
      else payload.password = row["VM-Password"];

      const billing = row.billingType ? row.billingType.toUpperCase() : "MONTHLY";
      if (!["HOURLY", "MONTHLY", "QUARTERLY"].includes(billing)) {
        errors.push("Invalid billingType (must be HOURLY, MONTHLY, or QUARTERLY)");
      } else {
        payload.billingType = billing;
      }

      if (row["VM-StartDate"] || row["VM-EndDate"] || row["VM-AssignedTo"]) {
        if (!row["VM-AssignedTo"]) errors.push("Missing VM-AssignedTo (required if dates provided)");
        if (!row["VM-StartDate"]) errors.push("Missing VM-StartDate");
        if (!row["VM-EndDate"]) errors.push("Missing VM-EndDate");
        
        if (row["VM-StartDate"] && row["VM-EndDate"]) {
          const s = new Date(row["VM-StartDate"]);
          const e = new Date(row["VM-EndDate"]);
          if (isNaN(s.getTime())) errors.push("Invalid VM-StartDate (use YYYY-MM-DD)");
          else if (isNaN(e.getTime())) errors.push("Invalid VM-EndDate (use YYYY-MM-DD)");
          else if (e < s) errors.push("EndDate cannot be before StartDate");
          else {
            payload.assignedTo = row["VM-AssignedTo"];
            payload.startDate = s.toISOString();
            payload.endDate = e.toISOString();
          }
        }
      }

      // Handle config
      if (row.configPreset) {
        const preset = presets.find(p => p.name === row.configPreset.trim());
        if (!preset) errors.push(`Unknown preset: "${row.configPreset}"`);
        else payload.configPresetId = preset.id;
      } else {
        const vcpus = parseInt(row.customVcpus);
        const ram = parseInt(row.customRamGb);
        const disk = parseInt(row.customDiskGb);
        
        if (!isNaN(vcpus) && !isNaN(ram) && !isNaN(disk)) {
          payload.customVcpus = vcpus;
          payload.customRamGb = ram;
          payload.customDiskGb = disk;
        }
      }

      return {
        original: row,
        payload,
        isValid: errors.length === 0,
        errors
      };
    });

    setParsedRows(validated);
  }

  async function handleImport() {
    const validPayloads = parsedRows.filter(r => r.isValid).map(r => r.payload);
    if (validPayloads.length === 0) return;

    setLoading(true);
    try {
      const res = await fetch("/api/vm-inventory/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayloads),
      });

      if (!res.ok) {
        const err = await res.json();
        toast({ variant: "destructive", title: "Bulk import failed", description: err.error });
      } else {
        const data = await res.json();
        toast({ variant: "success", title: "Import successful", description: `${data.count} VMs added.` });
        onSaved();
      }
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  const validCount = parsedRows.filter(r => r.isValid).length;
  const errorCount = parsedRows.length - validCount;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Add via CSV</DialogTitle>
          <DialogDescription>
            Download the template, fill in your VM details, and upload to bulk create inventory items.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-gray-50 border rounded-md p-3 mb-2 overflow-x-auto">
          <p className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wider">Expected Format</p>
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead>
              <tr>
                <th className="pr-4 pb-1 text-gray-600 font-medium">ipAddress</th>
                <th className="pr-4 pb-1 text-gray-600 font-medium">VM-Username</th>
                <th className="pr-4 pb-1 text-gray-600 font-medium">VM-Password</th>
                <th className="pr-4 pb-1 text-gray-600 font-medium">VM-AssignedTo</th>
                <th className="pr-4 pb-1 text-gray-600 font-medium">VM-StartDate</th>
                <th className="pr-4 pb-1 text-gray-600 font-medium">VM-EndDate</th>
                <th className="pr-4 pb-1 text-gray-600 font-medium">configPreset</th>
                <th className="pr-4 pb-1 text-gray-600 font-medium">customVcpus</th>
                <th className="pr-4 pb-1 text-gray-600 font-medium">customRamGb</th>
                <th className="pr-4 pb-1 text-gray-600 font-medium">customDiskGb</th>
                <th className="pb-1 text-gray-600 font-medium">billingType</th>
              </tr>
            </thead>
            <tbody className="text-gray-500">
              <tr>
                <td className="pr-4">10.0.0.5</td>
                <td className="pr-4">Administrator</td>
                <td className="pr-4">SamplePass123!</td>
                <td className="pr-4">John Doe</td>
                <td className="pr-4">2024-01-01</td>
                <td className="pr-4">2024-01-15</td>
                <td className="pr-4">16GB / 4 vCPU / 200GB SSD</td>
                <td className="pr-4"></td>
                <td className="pr-4"></td>
                <td className="pr-4"></td>
                <td>MONTHLY</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex gap-4 mb-4">
          <Button variant="outline" onClick={downloadTemplate}>
            Download Template
          </Button>
          <div>
            <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
            <Button onClick={() => fileInputRef.current?.click()}>
              Select CSV File
            </Button>
          </div>
        </div>

        {parsedRows.length > 0 && (
          <div className="flex-1 overflow-auto border rounded-md">
            <div className="p-3 bg-gray-50 border-b flex justify-between items-center text-sm">
              <span className="font-medium">Validation Preview</span>
              <span className="text-gray-500">
                <span className="text-green-600 font-medium">{validCount} valid</span> • <span className="text-red-600 font-medium">{errorCount} errors</span>
              </span>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">IP Address</th>
                  <th className="px-3 py-2">Config</th>
                  <th className="px-3 py-2 w-1/3">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {parsedRows.map((row, i) => (
                  <tr key={i} className={row.isValid ? "bg-white" : "bg-red-50"}>
                    <td className="px-3 py-2">{row.isValid ? "✅" : "❌"}</td>
                    <td className="px-3 py-2">{row.original.ipAddress || "—"}</td>
                    <td className="px-3 py-2">{row.original.configPreset || "Custom"}</td>
                    <td className="px-3 py-2 text-red-600 text-xs">
                      {row.errors.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleImport} disabled={validCount === 0 || loading} loading={loading}>
            Import {validCount} valid {validCount === 1 ? "row" : "rows"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
