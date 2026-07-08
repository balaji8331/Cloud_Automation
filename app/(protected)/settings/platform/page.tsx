"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Server, CheckCircle, XCircle } from "lucide-react";

export default function PlatformSettingsPage() {
  const { toast } = useToast();
  
  const [subscriptionId, setSubscriptionId] = useState("");
  const [resourceGroup, setResourceGroup] = useState("");
  const [location, setLocation] = useState("eastus");
  
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  useEffect(() => {
    fetch("/api/settings/aci")
      .then(res => res.json())
      .then(data => {
        if (data.subscriptionId) setSubscriptionId(data.subscriptionId);
        if (data.resourceGroup) setResourceGroup(data.resourceGroup);
        if (data.location) setLocation(data.location);
      })
      .catch(console.error);
  }, []);

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscriptionId || !resourceGroup) return;

    setIsTesting(true);
    toast({ title: "Testing permissions...", description: "Provisioning a test container. This may take 30-60 seconds." });
    
    try {
      const res = await fetch("/api/settings/aci/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId, resourceGroup, location })
      });
      const data = await res.json();
      
      if (res.ok) {
        toast({ title: "Success", description: data.message, variant: "default" });
      } else {
        toast({ variant: "destructive", title: "Test Failed", description: data.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: "Failed to test configuration." });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscriptionId || !resourceGroup) return;

    setIsSaving(true);
    try {
      const res = await fetch("/api/settings/aci", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId, resourceGroup, location })
      });
      const data = await res.json();
      
      if (res.ok) {
        toast({ title: "Configuration Saved", description: "The platform settings have been updated and cached." });
      } else {
        toast({ variant: "destructive", title: "Error", description: data.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: "Failed to save configuration." });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>
          <p className="text-muted-foreground mt-2">
            Configure global platform services and hosting infrastructure.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-600" />
            Container Hosting Configuration
          </CardTitle>
          <CardDescription>
            This is the Azure subscription where our platform's ephemeral script and terminal containers run. 
            <strong className="text-red-600 ml-1">This is completely separate from your client tenants</strong> — do NOT enter a client's subscription ID here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Subscription ID (Host)</label>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background font-mono"
                placeholder="e.g. 11111111-2222-3333-4444-555555555555"
                value={subscriptionId}
                onChange={(e) => setSubscriptionId(e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Resource Group (Host)</label>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background font-mono"
                placeholder="e.g. rg-platform-aci"
                value={resourceGroup}
                onChange={(e) => setResourceGroup(e.target.value)}
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Location</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                >
                  <option value="eastus">East US (eastus)</option>
                  <option value="westus">West US (westus)</option>
                  <option value="centralus">Central US (centralus)</option>
                  <option value="northeurope">North Europe (northeurope)</option>
                  <option value="westeurope">West Europe (westeurope)</option>
                </select>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Credential Source</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-gray-100 text-gray-500 px-3 py-2 text-sm ring-offset-background cursor-not-allowed"
                  disabled
                >
                  <option>DefaultAzureCredential</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Using the managed identity / environment of this worker process.
                </p>
              </div>
            </div>

            <div className="pt-4 flex gap-4">
              <Button type="button" variant="outline" onClick={handleTest} disabled={isTesting || !subscriptionId || !resourceGroup}>
                {isTesting ? "Testing..." : "Test Permissions"}
              </Button>
              <Button type="submit" variant="default" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSave} disabled={isSaving || !subscriptionId || !resourceGroup}>
                {isSaving ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
