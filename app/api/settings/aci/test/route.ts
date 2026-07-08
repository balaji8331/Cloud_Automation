import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { ContainerInstanceManagementClient } from "@azure/arm-containerinstance";
import { DefaultAzureCredential } from "@azure/identity";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    await requireRole("SUPER_ADMIN");
    const body = await req.json();
    const { subscriptionId, resourceGroup, location } = body;

    if (!subscriptionId || !resourceGroup || !location) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const credential = new DefaultAzureCredential();
    const aciClient = new ContainerInstanceManagementClient(credential, subscriptionId);

    const containerGroupName = `test-config-${crypto.randomUUID().split("-")[0]}`;

    // 1. Attempt Create
    await aciClient.containerGroups.beginCreateOrUpdateAndWait(resourceGroup, containerGroupName, {
      location,
      osType: "Linux",
      restartPolicy: "Never",
      containers: [{
        name: "test-cli",
        image: "alpine",
        resources: { requests: { memoryInGB: 1.0, cpu: 1.0 } },
        command: ["echo", "ok"]
      }]
    });

    // 2. Attempt Delete immediately
    await aciClient.containerGroups.beginDeleteAndWait(resourceGroup, containerGroupName);

    return NextResponse.json({ success: true, message: "Successfully provisioned and deleted test container." });
  } catch (err: any) {
    if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[TestAciConfig] Error:", err);
    
    // Attempt to return the inner Azure error message for better debugging in UI
    const details = err?.details?.error?.message || err.message || "Unknown error";
    return NextResponse.json({ error: `Azure Error: ${details}` }, { status: 400 });
  }
}
