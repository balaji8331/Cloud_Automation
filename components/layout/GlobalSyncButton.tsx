"use client";
import { useState, useEffect, useRef } from "react";
import { RefreshCw, ChevronDown, Check, AlertCircle, Server, DollarSign } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTenants } from "@/lib/context/TenantsContext";
import { useSyncEvent } from "@/lib/context/SyncEventContext";
import { cn } from "@/lib/utils";

type Tenant = { id: string; name: string; status: "PENDING" | "CONNECTED" | "ERROR" };

type SyncType = "costs" | "resources" | "both";

interface SyncState {
  tenantId: string;
  tenantName: string;
  type: SyncType;
  status: "running" | "success" | "error";
  message?: string;
}

export function GlobalSyncButton() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  // Use shared context — no duplicate fetch
  const { tenants } = useTenants();
  const { notifySyncComplete } = useSyncEvent();

  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState<SyncState[]>([]);
  const [lastResult, setLastResult] = useState<"success" | "error" | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Auto-clear last result after 4s
  useEffect(() => {
    if (lastResult) {
      const t = setTimeout(() => setLastResult(null), 4000);
      return () => clearTimeout(t);
    }
  }, [lastResult]);

  if (!isAdmin) return null;

  const isAnySyncing = syncing.some((s) => s.status === "running");

  async function syncTenant(tenant: Tenant, type: SyncType) {
    const entry: SyncState = {
      tenantId: tenant.id,
      tenantName: tenant.name,
      type,
      status: "running",
    };
    setSyncing((prev) => [...prev.filter((s) => s.tenantId !== tenant.id || s.type !== type), entry]);

    try {
      if (type === "costs" || type === "both") {
        const res = await fetch(`/api/tenants/${tenant.id}/sync`, { method: "POST" });
        const data = await res.json();
        if (!data.success) throw new Error(data.error ?? "Cost sync failed");
      }

      if (type === "resources" || type === "both") {
        const res = await fetch(`/api/resources/sync?tenantId=${tenant.id}`, { method: "POST" });
        const data = await res.json();
        if (!data.success) throw new Error(data.error ?? "Resource sync failed");
      }

      setSyncing((prev) =>
        prev.map((s) =>
          s.tenantId === tenant.id && s.type === type
            ? { ...s, status: "success", message: "Done" }
            : s
        )
      );
      setLastResult("success");
      // Notify all pages that data has been refreshed
      if (type === "costs" || type === "both") {
        notifySyncComplete();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSyncing((prev) =>
        prev.map((s) =>
          s.tenantId === tenant.id && s.type === type
            ? { ...s, status: "error", message: msg }
            : s
        )
      );
      setLastResult("error");
    }

    // Clean up after 5s
    setTimeout(() => {
      setSyncing((prev) => prev.filter((s) => !(s.tenantId === tenant.id && s.type === type)));
    }, 5000);
  }

  async function syncAll(type: SyncType) {
    for (const tenant of tenants) {
      await syncTenant(tenant, type);
    }
  }

  function getStateForTenant(tenantId: string, type: SyncType) {
    return syncing.find((s) => s.tenantId === tenantId && s.type === type);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-3 h-8 text-xs font-medium transition-colors",
          isAnySyncing
            ? "border-blue-300 bg-blue-50 text-blue-700"
            : lastResult === "success"
            ? "border-green-300 bg-green-50 text-green-700"
            : lastResult === "error"
            ? "border-red-300 bg-red-50 text-red-700"
            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        )}
        aria-label="Sync options"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", isAnySyncing && "animate-spin")} />
        Sync
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-10 z-50 w-72 rounded-xl border border-gray-200 bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Sync Tenants</p>
            <div className="flex gap-1.5">
              <button
                onClick={() => syncAll("costs")}
                disabled={isAnySyncing}
                className="flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <DollarSign className="h-3 w-3" />
                All costs
              </button>
              <button
                onClick={() => syncAll("resources")}
                disabled={isAnySyncing}
                className="flex items-center gap-1 rounded-md bg-purple-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                <Server className="h-3 w-3" />
                All resources
              </button>
            </div>
          </div>

          {/* Tenant list */}
          <div className="max-h-72 overflow-y-auto py-1">
            {tenants.length === 0 && (
              <p className="px-4 py-3 text-xs text-gray-400">No tenants configured</p>
            )}
            {tenants.map((tenant) => {
              const costState = getStateForTenant(tenant.id, "costs");
              const resState = getStateForTenant(tenant.id, "resources");

              return (
                <div key={tenant.id} className="px-4 py-2.5 hover:bg-gray-50">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          tenant.status === "CONNECTED" ? "bg-green-500" :
                          tenant.status === "ERROR" ? "bg-red-500" : "bg-yellow-400"
                        )}
                      />
                      <p className="text-xs font-medium text-gray-800">{tenant.name}</p>
                    </div>
                  </div>

                  <div className="flex gap-1.5">
                    {/* Cost sync */}
                    <button
                      onClick={() => syncTenant(tenant, "costs")}
                      disabled={isAnySyncing}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40",
                        costState?.status === "running"
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : costState?.status === "success"
                          ? "border-green-300 bg-green-50 text-green-700"
                          : costState?.status === "error"
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-gray-200 text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      {costState?.status === "running" ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : costState?.status === "success" ? (
                        <Check className="h-3 w-3" />
                      ) : costState?.status === "error" ? (
                        <AlertCircle className="h-3 w-3" />
                      ) : (
                        <DollarSign className="h-3 w-3" />
                      )}
                      {costState?.status === "running" ? "Syncing…" :
                       costState?.status === "success" ? "Done" :
                       costState?.status === "error" ? "Failed" : "Costs"}
                    </button>

                    {/* Resource sync */}
                    <button
                      onClick={() => syncTenant(tenant, "resources")}
                      disabled={isAnySyncing}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40",
                        resState?.status === "running"
                          ? "border-purple-300 bg-purple-50 text-purple-700"
                          : resState?.status === "success"
                          ? "border-green-300 bg-green-50 text-green-700"
                          : resState?.status === "error"
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-gray-200 text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      {resState?.status === "running" ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : resState?.status === "success" ? (
                        <Check className="h-3 w-3" />
                      ) : resState?.status === "error" ? (
                        <AlertCircle className="h-3 w-3" />
                      ) : (
                        <Server className="h-3 w-3" />
                      )}
                      {resState?.status === "running" ? "Syncing…" :
                       resState?.status === "success" ? "Done" :
                       resState?.status === "error" ? "Failed" : "Resources"}
                    </button>

                    {/* Both */}
                    <button
                      onClick={() => syncTenant(tenant, "both")}
                      disabled={isAnySyncing}
                      className="flex items-center justify-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Both
                    </button>
                  </div>

                  {/* Error message */}
                  {(costState?.status === "error" || resState?.status === "error") && (
                    <p className="mt-1 text-[10px] text-red-600 truncate" title={costState?.message ?? resState?.message}>
                      {costState?.message ?? resState?.message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer note */}
          <div className="border-t border-gray-100 px-4 py-2">
            <p className="text-[10px] text-gray-400">
              Cost sync pulls last 7 days. Resource sync updates full inventory.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
