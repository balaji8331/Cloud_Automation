import prisma from "../lib/db/index";
import { decryptJson } from "../lib/crypto";

async function main() {
  const tenants = await prisma.tenant.findMany({
    include: { cloudCredential: true }
  });

  for (const t of tenants) {
    if (!t.cloudCredential) continue;
    const creds = decryptJson<{ azureTenantId: string, clientId: string, clientSecretEnc: string }>(t.cloudCredential.credentialData);
    
    // I am decrypting manually to avoid importing from db/tenants which might have issues
    const { decrypt } = require("../lib/crypto");
    const secret = decrypt(creds.clientSecretEnc);
    
    console.log(`Tenant: ${t.name}`);
    console.log(`  Tenant ID: "${creds.azureTenantId}"`);
    console.log(`  Client ID: "${creds.clientId}"`);
    console.log(`  Secret   : "${secret}"`);
    console.log(`  Secret Length: ${secret.length}`);
    console.log("-----------------------------------------");
  }
}

main().catch(console.error);
