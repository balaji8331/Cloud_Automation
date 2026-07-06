/**
 * Azure authentication via MSAL / @azure/identity.
 * Each tenant gets its own ClientSecretCredential.
 */
import { ClientSecretCredential } from "@azure/identity";

const SCOPE = "https://management.azure.com/.default";

export interface AzureCredentialConfig {
  azureTenantId: string;
  clientId: string;
  clientSecret: string;
}

/** Returns a bearer token for the Azure Management API */
export async function getAzureAccessToken(
  config: AzureCredentialConfig
): Promise<string> {
  const credential = new ClientSecretCredential(
    config.azureTenantId,
    config.clientId,
    config.clientSecret
  );

  const token = await credential.getToken(SCOPE);
  if (!token?.token) {
    throw new Error(
      `Failed to acquire token for tenant ${config.azureTenantId}`
    );
  }
  return token.token;
}

/** Test that the service principal can authenticate */
export async function testAzureAuth(
  config: AzureCredentialConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    await getAzureAccessToken(config);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
