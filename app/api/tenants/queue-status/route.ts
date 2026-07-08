/**
 * GET /api/tenants/queue-status
 * Returns per-tenant Azure API queue / rate-limit state for the Tenants UI.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { getTenantQueueStatus } from "@/lib/azure/tenantQueue";
import { decryptJson } from "@/lib/crypto";

export async function GET() {
  try {
    await requireAuth();

    const tenants = await prisma.tenant.findMany({
      select: { id: true, cloudCredential: true },
    });

    const status: Record<
      string,
      ReturnType<typeof getTenantQueueStatus>
    > = {};

    for (const t of tenants) {
      // Extract azureTenantId from the encrypted credential blob
      if (t.cloudCredential) {
        const creds = decryptJson<{ azureTenantId: string }>(
          t.cloudCredential.credentialData
        );
        status[t.id] = getTenantQueueStatus(creds.azureTenantId);
      }
    }

    return NextResponse.json({ status });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
