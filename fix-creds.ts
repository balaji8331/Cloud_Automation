import prisma from "./lib/db/index";
import { encrypt } from "./lib/crypto/index";

async function run() {
  const creds = await prisma.cloudCredential.findMany();
  for (const cred of creds) {
    if (cred.credentialData.startsWith("{")) {
      console.log(`Encrypting raw JSON for tenant: ${cred.tenantId}`);
      const encrypted = encrypt(cred.credentialData);
      await prisma.cloudCredential.update({
        where: { id: cred.id },
        data: { credentialData: encrypted },
      });
    }
  }
  console.log("Done");
}
run().catch(console.error);
