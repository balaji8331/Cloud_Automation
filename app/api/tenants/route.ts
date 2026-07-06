/**
 * GET  /api/tenants        — list all tenants (sanitized, no secrets)
 * POST /api/tenants        — create a new tenant
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { getAllTenants, createTenant } from "@/lib/db/tenants";
import { writeAuditLog } from "@/lib/db/audit";

const CreateTenantSchema = z.object({
  name: z.string().min(1).max(100),
  azureTenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  clientSecret: z.string().min(1),
  subscriptionIds: z.array(z.string().uuid()).min(1),
});

export async function GET() {
  try {
    const session = await requireRole("READONLY");
    const tenants = await getAllTenants();

    // Skip audit log for list reads — too noisy, high frequency
    // await writeAuditLog({ userId: session.user.id, action: "VIEW_TENANTS" });

    // Strip encrypted secret from response
    const sanitized = tenants.map(({ clientSecretEnc: _secret, ...t }) => t);
    return NextResponse.json(sanitized);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = CreateTenantSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const tenant = await createTenant(parsed.data);
    const { clientSecretEnc: _secret, ...sanitized } = tenant;

    await writeAuditLog({
      userId: session.user.id,
      action: "CREATE_TENANT",
      resourceType: "tenant",
      resourceId: tenant.id,
    });

    return NextResponse.json(sanitized, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    console.error("[POST /api/tenants]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
