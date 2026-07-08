import prisma from "./lib/db/index";
import { decryptJson } from "./lib/crypto/index";

async function run() {
  const tenants = await prisma.tenant.findMany({
    include: { subscriptions: true, cloudCredential: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("Tenants:", JSON.stringify(tenants, null, 2));
  for (const t of tenants) {
      if (t.cloudCredential) {
          const cred = decryptJson(t.cloudCredential.credentialData);
          console.log("Creds for", t.name, ":", cred);
      }
  }
}
run().catch(console.error);
