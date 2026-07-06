/**
 * GET /api/automation/check-permissions?tenantId=xxx
 * Checks if the tenant's service principal has Contributor access.
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import { getTenantCredentials } from "@/lib/db/tenants";
import { checkContributorAccess } from "@/lib/azure/budgets";
import prisma from "@/lib/db";

export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

    const creds = await getTenantCredentials(tenantId);
    if (!creds) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    // Check against first subscription
    const firstSub = creds.subscriptions[0];
    if (!firstSub) return NextResponse.json({ hasAccess: false, role: "No subscriptions configured" });

    const result = await checkContributorAccess(
      { azureTenantId: creds.azureTenantId, clientId: creds.clientId, clientSecret: creds.clientSecret },
      firstSub.subscriptionId
    );

    // Cache result on tenant
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { errorMessage: result.hasAccess ? null : `Contributor check: ${result.role}` },
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
