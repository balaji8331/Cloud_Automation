import { ContainerInstanceManagementClient, ContainerGroup } from "@azure/arm-containerinstance";
import { DefaultAzureCredential } from "@azure/identity";
import { getAciConfig } from "@/lib/db/settings";
import { Duplex } from "stream";
import WebSocket from "ws";
import type { TerminalAdapter, SpawnResult, SpawnOpts } from "./types";
import crypto from "crypto";

export class AzureAciTerminalAdapter implements TerminalAdapter {
  private client!: ContainerInstanceManagementClient;
  private subscriptionId: string;
  private resourceGroup: string;

  constructor() {
    this.subscriptionId = "";
    this.resourceGroup = "";
  }

  async spawn(opts: SpawnOpts): Promise<SpawnResult> {
    const aciConfig = await getAciConfig();
    this.subscriptionId = aciConfig.subscriptionId;
    this.resourceGroup = aciConfig.resourceGroup;
    
    if (!this.subscriptionId || !this.resourceGroup) {
      throw new Error("AzureAciTerminalAdapter requires ACI_SUBSCRIPTION_ID and ACI_RESOURCE_GROUP in settings.");
    }

    const credential = new DefaultAzureCredential();
    this.client = new ContainerInstanceManagementClient(credential, this.subscriptionId);

    const uniqueId = crypto.randomUUID().split("-")[0];
    const containerGroupName = `term-session-${uniqueId}`;
    const containerName = "cli";

    const environmentVariables = Object.entries(opts.env || {}).map(([name, value]) => ({
      name,
      value
    }));

    console.log(`[ACI] Provisioning container group: ${containerGroupName}`);

    await this.client.containerGroups.beginCreateOrUpdateAndWait(this.resourceGroup, containerGroupName, {
      location: aciConfig.location,
      osType: "Linux",
      restartPolicy: "Never",
      containers: [
        {
          name: containerName,
          image: "mcr.microsoft.com/azure-cli:latest",
          resources: { requests: { memoryInGB: 1.0, cpu: 1.0 } },
          environmentVariables,
          command: ["tail", "-f", "/dev/null"],
        }
      ]
    });

    console.log(`[ACI] Connecting terminal to container group: ${containerGroupName}`);

    const execResponse = await this.client.containers.executeCommand(this.resourceGroup, containerGroupName, containerName, {
      command: "/bin/bash",
      terminalSize: { cols: 80, rows: 24 }
    });

    if (!execResponse.webSocketUri || !execResponse.password) {
      throw new Error("Failed to get WebSocket URI from Azure Container Instances");
    }

    const ws = new WebSocket(execResponse.webSocketUri);
    
    const stream = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        }
        callback();
      }
    });

    ws.on("open", () => {
      // Azure ACI requires sending the generated password as the first message
      ws.send(execResponse.password!);
      
      // If an init command was provided, write it to the bash shell
      if (opts.initCommand) {
        // Send the command and hit Enter
        ws.send(`${opts.initCommand}\r`);
      }
    });

    ws.on("message", (data: WebSocket.RawData) => {
      stream.push(data);
    });

    ws.on("close", () => {
      stream.push(null);
    });

    ws.on("error", (err) => {
      console.error("[ACI] WebSocket error:", err);
      stream.push(null);
    });

    return {
      executionId: containerGroupName,
      stream,
      resize: async (cols: number, rows: number) => {
        // Dynamic resize over WS is unsupported in the basic ACI executeCommand API, but can be simulated or ignored safely
      }
    };
  }

  async destroy(executionId: string): Promise<void> {
    try {
      console.log(`[ACI] Deleting container group: ${executionId}`);
      await this.client.containerGroups.beginDeleteAndWait(this.resourceGroup, executionId);
    } catch (err) {
      console.error(`[ACI] Failed to destroy container group ${executionId}:`, err);
    }
  }
}
