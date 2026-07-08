import prisma from "./index";

export interface AciConfigData {
  subscriptionId: string;
  resourceGroup: string;
  location: string;
}

let cache: { data: AciConfigData | null; expiresAt: number } = { data: null, expiresAt: 0 };
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getAciConfig(): Promise<AciConfigData> {
  const now = Date.now();
  
  if (cache.expiresAt > now && cache.data) {
    return cache.data;
  }

  const dbConfig = await prisma.aciConfig.findFirst();

  let data: AciConfigData;
  if (dbConfig) {
    data = {
      subscriptionId: dbConfig.subscriptionId,
      resourceGroup: dbConfig.resourceGroup,
      location: dbConfig.location,
    };
  } else {
    // Fallback to bootstrap .env values if no DB config exists
    data = {
      subscriptionId: process.env.ACI_SUBSCRIPTION_ID || "",
      resourceGroup: process.env.ACI_RESOURCE_GROUP || "",
      location: process.env.ACI_LOCATION || "eastus",
    };
  }

  cache = { data, expiresAt: now + TTL_MS };
  return data;
}

export function invalidateAciConfigCache() {
  cache.expiresAt = 0;
}
