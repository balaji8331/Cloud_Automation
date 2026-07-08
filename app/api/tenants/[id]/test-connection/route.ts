/**
 * POST /api/tenants/:id/test-connection
 * Tests Azure service principal auth + Cost Management access for all subscriptions.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getTenantCredentials, setTenantStatus } from "@/lib/db/tenants";
import { runTenantOperation, TenantBusyError } from "@/lib/azure/tenantQueue";
import { getProviderClient } from "@/lib/providers";
import { writeAuditLog } from "@/lib/db/audit";
import prisma from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");
    const creds = await getTenantCredentials(params.id);

    if (!creds) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const payload = await runTenantOperation(
      creds.azureTenantId,
      "test-connection",
      async () => {
        const results: {
          subscriptionId: string;
          subscriptionName?: string;
          success: boolean;
          error?: string;
        }[] = [];

        let allSuccess = true;

        const providerClient = getProviderClient({
          provider: creds.provider,
          credentialData: creds.credentialData
        });

        for (const sub of creds.subscriptions) {
          const result = await providerClient.testConnection({
            providerScopeId: sub.subscriptionId
          });

          results.push({
            subscriptionId: sub.subscriptionId,
            subscriptionName: result.scopeName,
            success: result.success,
            error: result.error,
          });

          if (!result.success) allSuccess = false;

          if (result.scopeName) {
            await prisma.subscription.update({
              where: { id: sub.id },
              data: { subscriptionName: result.scopeName },
            });
          }
        }

        await setTenantStatus(
          params.id,
          allSuccess ? "CONNECTED" : "ERROR",
          allSuccess ? undefined : results.find((r) => !r.success)?.error
        );

        await writeAuditLog({
          userId: session.user.id,
          action: "TEST_CONNECTION",
          resourceType: "tenant",
          resourceId: params.id,
        });

        return { allSuccess, results };
      },
      { rejectIfBusy: true }
    );

    return NextResponse.json(
      { success: payload.allSuccess, results: payload.results },
      { status: payload.allSuccess ? 200 : 502 }
    );
  } catch (err: unknown) {
    if (err instanceof TenantBusyError) {
      return NextResponse.json(
        { success: false, error: err.message, busy: true },
        { status: 409 }
      );
    }
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    console.error("[test-connection]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
