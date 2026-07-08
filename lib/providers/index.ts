import type { CloudProvider } from "@prisma/client";
import { decrypt, decryptJson } from "@/lib/crypto";
import type { CloudProviderClient } from "./types";
import { AzureProviderClient } from "./azure"; 

export interface BaseCloudCredential {
  provider: CloudProvider;
  credentialData: string;
}

interface AzureCredentialData {
  azureTenantId: string;
  clientId: string;
  clientSecretEnc: string;
}

export function getProviderClient(
  credential: BaseCloudCredential
): CloudProviderClient {
  if (credential.provider === "AZURE") {
    const creds = decryptJson<AzureCredentialData>(credential.credentialData);
    return new AzureProviderClient({
      azureTenantId: creds.azureTenantId,
      clientId: creds.clientId,
      clientSecret: decrypt(creds.clientSecretEnc),
    });
  }

  throw new Error(`Provider ${credential.provider} not yet implemented`);
}
