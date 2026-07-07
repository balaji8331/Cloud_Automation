"use client";
import { useState, useEffect, useCallback } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TenantsTable } from "@/components/tables/TenantsTable";
import { TenantFormDialog } from "./TenantFormDialog";
import { useToast } from "@/components/ui/toast";

interface Subscription {
  id: string;
  subscriptionId: string;
  subscriptionName: string | null;
  isActive: boolean;
}

interface Tenant {
  id: string;
  name: string;
  azureTenantId: string;
  clientId: string;
  status: "PENDING" | "CONNECTED" | "ERROR";
  errorMessage: string | null;
  lastSyncAt: string | null;
  subscriptions: Subscription[];
}

export default function TenantsPage() {
  const { toast } = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tenants");
      const data = await res.json();
      setTenants(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this tenant? This will remove all associated cost data.")) return;
    const res = await fetch(`/api/tenants/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast({ variant: "success", title: "Tenant deleted" });
      fetchTenants();
    } else {
      toast({ variant: "destructive", title: "Delete failed" });
    }
  }

  function handleEdit(tenant: Tenant) {
    setEditingTenant(tenant);
    setDialogOpen(true);
  }

  function handleAdd() {
    setEditingTenant(null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            Manage Azure service principals and subscription connections.
          </p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="h-4 w-4" />
          Add Tenant
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Connected Tenants{" "}
            <span className="text-sm font-normal text-gray-500 ml-1">({tenants.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <TenantsTable
              tenants={tenants}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRefresh={fetchTenants}
            />
          )}
        </CardContent>
      </Card>

      <TenantFormDialog
        open={dialogOpen}
        tenant={editingTenant}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          setDialogOpen(false);
          fetchTenants();
        }}
      />
    </div>
  );
}
