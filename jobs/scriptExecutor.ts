import { PrismaClient, ScriptStatus } from "@prisma/client";
import { ContainerInstanceManagementClient } from "@azure/arm-containerinstance";
import { DefaultAzureCredential } from "@azure/identity";
import { decryptJson, decrypt } from "@/lib/crypto";
import { sendEmail } from "@/lib/email";
import { writeAuditLog } from "@/lib/db/audit";
import { getAciConfig } from "@/lib/db/settings";
import crypto from "crypto";

const prisma = new PrismaClient();

export async function executeScriptRun(scriptRunId: string) {
  const run = await prisma.scriptRun.findUnique({
    where: { id: scriptRunId },
    include: { tenant: { include: { cloudCredential: true } } }
  });

  if (!run || run.status !== "running") return;
  if (!run.tenant.cloudCredential) throw new Error("Tenant has no credentials");

  const creds = decryptJson(run.tenant.cloudCredential.credentialData) as { azureTenantId: string; clientId: string; clientSecretEnc: string };
  const clientSecret = decrypt(creds.clientSecretEnc);

  // ACI_SUBSCRIPTION_ID and ACI_RESOURCE_GROUP refer to OUR management subscription 
  // used to HOST the ephemeral container instances. This is completely separate 
  const aciConfig = await getAciConfig();
  const subId = aciConfig.subscriptionId;
  const rg = aciConfig.resourceGroup;

  if (!subId || !rg) {
    throw new Error("Missing ACI_SUBSCRIPTION_ID or ACI_RESOURCE_GROUP. Please configure Platform Settings in the portal.");
  }

  const credential = new DefaultAzureCredential();
  const aciClient = new ContainerInstanceManagementClient(credential, subId);

  const containerGroupName = `script-run-${crypto.randomUUID().split("-")[0]}`;
  
  const envVars: any[] = [
    { name: "AZURE_TENANT_ID", value: creds.azureTenantId },
    { name: "AZURE_CLIENT_ID", value: creds.clientId },
    { name: "AZURE_CLIENT_SECRET", secureValue: clientSecret },
    { name: "SCRIPT_CONTENT", value: run.scriptContent }
  ];
  
  if (run.subscriptionId) envVars.push({ name: "TARGET_SUBSCRIPTION", value: run.subscriptionId });
  if (run.targetResourceGroup) envVars.push({ name: "TARGET_RESOURCE_GROUP", value: run.targetResourceGroup });

  const isBash = run.scriptType === "bash";
  const image = isBash ? "mcr.microsoft.com/azure-cli:latest" : "mcr.microsoft.com/azure-powershell:latest";
  
  // Unset the secret immediately after login to prevent leakage in script output or `env` calls.
  const command = isBash 
    ? ["/bin/bash", "-c", "az login --service-principal -u \"$AZURE_CLIENT_ID\" -p \"$AZURE_CLIENT_SECRET\" --tenant \"$AZURE_TENANT_ID\" > /dev/null && unset AZURE_CLIENT_SECRET && eval \"$SCRIPT_CONTENT\""]
    : ["pwsh", "-Command", "Connect-AzAccount -ServicePrincipal -Credential (New-Object System.Management.Automation.PSCredential($env:AZURE_CLIENT_ID, (ConvertTo-SecureString $env:AZURE_CLIENT_SECRET -AsPlainText -Force))) -Tenant $env:AZURE_TENANT_ID > $null ; Remove-Item Env:\\AZURE_CLIENT_SECRET ; Invoke-Expression $env:SCRIPT_CONTENT"];

  let exitCode = 1;

    try {
      console.log(`[ScriptExecutor] Provisioning container group: ${containerGroupName}`);
      await aciClient.containerGroups.beginCreateOrUpdateAndWait(rg, containerGroupName, {
        location: aciConfig.location,
        osType: "Linux",
      restartPolicy: "Never",
      containers: [{
        name: "cli",
        image,
        resources: { requests: { memoryInGB: 1.0, cpu: 1.0 } },
        environmentVariables: envVars,
        command
      }]
    });

    let state = "Running";
    let timeout = 30 * 60; // 30 mins
    
    console.log(`[ScriptExecutor] Waiting for container to terminate...`);
    while ((state === "Running" || state === "Pending") && timeout > 0) {
      await new Promise(r => setTimeout(r, 10000));
      timeout -= 10;
      const cg = await aciClient.containerGroups.get(rg, containerGroupName);
      const containerState = cg.containers?.[0]?.instanceView?.currentState;
      state = containerState?.state || "Unknown";
      if (state === "Terminated") {
        exitCode = containerState?.exitCode ?? 1;
      }
    }

    if (timeout <= 0) throw new Error("Script execution timed out after 30 minutes.");

    const logsResponse = await aciClient.containers.listLogs(rg, containerGroupName, "cli");
    const rawOutput = logsResponse.content || "No output";
    
    // Redact secret unconditionally
    const redactedOutput = rawOutput.split(clientSecret).join("[REDACTED]");
    
    await prisma.scriptRun.update({
      where: { id: scriptRunId },
      data: {
        status: exitCode === 0 ? "completed" : "failed",
        output: redactedOutput,
        exitCode,
        completedAt: new Date()
      }
    });

    await sendEmail({
      to: process.env.ALERT_TO_EMAIL!,
      subject: `[${exitCode === 0 ? "Success" : "Failed"}] Script run on ${run.tenant.name}`,
      html: `<p>Status: ${exitCode === 0 ? "Completed" : "Failed"} (Exit Code: ${exitCode})</p><p>Check portal for full logs.</p>`
    });

    await writeAuditLog({
      userId: run.triggeredById,
      action: exitCode === 0 ? "SCRIPT_RUN_COMPLETED" : "SCRIPT_RUN_FAILED",
      resourceType: "tenant",
      resourceId: run.tenantId,
      metadata: { scriptRunId, exitCode }
    });

  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    const redactedError = errorMessage.split(clientSecret).join("[REDACTED]");
    
    await prisma.scriptRun.update({
      where: { id: scriptRunId },
      data: { status: "failed", output: redactedError, completedAt: new Date() }
    });

    await writeAuditLog({
      userId: run.triggeredById,
      action: "SCRIPT_RUN_FAILED",
      resourceType: "tenant",
      resourceId: run.tenantId,
      metadata: { scriptRunId, error: redactedError }
    });
  } finally {
    console.log(`[ScriptExecutor] Destroying container group: ${containerGroupName}`);
    await aciClient.containerGroups.beginDeleteAndWait(rg, containerGroupName).catch(e => console.error("Cleanup failed", e));
  }
}
