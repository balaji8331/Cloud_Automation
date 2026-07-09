"use client";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { PlusCircle, X } from "lucide-react";

interface Tenant {
  id: string;
  name: string;
  azureTenantId: string;
  clientId: string;
  subscriptions: { subscriptionId: string }[];
}

interface TenantFormDialogProps {
  open: boolean;
  tenant: Tenant | null;
  onClose: () => void;
  onSaved: () => void;
}

export function TenantFormDialog({
  open,
  tenant,
  onClose,
  onSaved,
}: TenantFormDialogProps) {
  const { toast } = useToast();
  const isEdit = !!tenant;

  const [name, setName] = useState("");
  const [azureTenantId, setAzureTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [subscriptionIds, setSubscriptionIds] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (tenant) {
      setName(tenant.name);
      setAzureTenantId(tenant.azureTenantId);
      setClientId(tenant.clientId);
      setClientSecret("");
      setSubscriptionIds(tenant.subscriptions.map((s) => s.subscriptionId));
    } else {
      setName("");
      setAzureTenantId("");
      setClientId("");
      setClientSecret("");
      setSubscriptionIds([""]);
    }
    setErrors({});
  }, [tenant, open]);

  function addSubscription() {
    setSubscriptionIds((prev) => [...prev, ""]);
  }

  function removeSubscription(i: number) {
    setSubscriptionIds((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateSubscription(i: number, value: string) {
    setSubscriptionIds((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required";
    if (!azureTenantId.match(/^[0-9a-f-]{36}$/i)) e.azureTenantId = "Must be a valid UUID";
    if (!clientId.match(/^[0-9a-f-]{36}$/i)) e.clientId = "Must be a valid UUID";
    if (!isEdit && !clientSecret) e.clientSecret = "Client secret is required";
    const validSubs = subscriptionIds.filter((s) => s.trim());
    if (validSubs.length === 0) e.subscriptions = "At least one subscription ID is required";
    for (const s of validSubs) {
      if (!s.match(/^[0-9a-f-]{36}$/i)) {
        e.subscriptions = `"${s}" is not a valid subscription UUID`;
        break;
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    const validSubs = subscriptionIds.filter((s) => s.trim());

    const body: Record<string, unknown> = {
      name: name.trim(),
      azureTenantId: azureTenantId.trim(),
      clientId: clientId.trim(),
      subscriptionIds: validSubs,
    };
    if (clientSecret) body.clientSecret = clientSecret.trim();
    if (!isEdit) body.clientSecret = clientSecret.trim();

    const url = isEdit ? `/api/tenants/${tenant.id}` : "/api/tenants";
    const method = isEdit ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Save failed",
          description: data.error?.message ?? JSON.stringify(data.error),
        });
        return;
      }

      toast({ variant: "success", title: isEdit ? "Tenant updated" : "Tenant created" });
      onSaved();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Tenant" : "Add Azure Tenant"}</DialogTitle>
          <DialogDescription>
            Configure a service principal with Cost Management Reader on each subscription.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Tenant Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production Tenant"
            error={errors.name}
          />
          <Input
            label="Azure Tenant ID"
            value={azureTenantId}
            onChange={(e) => setAzureTenantId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            error={errors.azureTenantId}
            disabled={isEdit}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Client ID (App ID)"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-…"
              error={errors.clientId}
            />
            <Input
              label={isEdit ? "New Client Secret (leave blank to keep)" : "Client Secret"}
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="••••••••••••"
              error={errors.clientSecret}
            />
          </div>

          {/* Subscriptions */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">
              Subscription IDs
            </label>
            <div className="space-y-2">
              {subscriptionIds.map((subId, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={subId}
                    onChange={(e) => updateSubscription(i, e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="flex-1 h-9 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {subscriptionIds.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSubscription(i)}
                      className="text-gray-400 hover:text-red-500"
                      aria-label="Remove subscription"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {errors.subscriptions && (
              <p className="text-xs text-red-600 mt-1">{errors.subscriptions}</p>
            )}
            <button
              type="button"
              onClick={addSubscription}
              className="mt-2 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800"
            >
              <PlusCircle className="h-4 w-4" />
              Add another subscription
            </button>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {isEdit ? "Save changes" : "Add tenant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
