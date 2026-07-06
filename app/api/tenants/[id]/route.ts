/**
 * GET    /api/tenants/:id  — get single tenant
 * PATCH  /api/tenants/:id  — update tenant
 * DELETE /api/tenants/:id  — delete tenant
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { getTenantById, updateTenant, deleteTenant } from "@/lib/db/tenants";
import { writeAuditLog } from "@/lib/db/audit";

const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  clientId: z.string().uuid().optional(),
  clientSecret: z.string().min(1).optional(),
  subscriptionIds: z.array(z.string().uuid()).min(1).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("READONLY");
    const tenant = await getTenantById(params.id);
    if (!tenant) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await writeAuditLog({
      userId: session.user.id,
      action: "VIEW_TENANTS",
      resourceType: "tenant",
      resourceId: params.id,
    });

    const { clientSecretEnc: _secret, ...sanitized } = tenant;
    return NextResponse.json(sanitized);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = UpdateTenantSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const tenant = await updateTenant(params.id, parsed.data);
    const { clientSecretEnc: _secret, ...sanitized } = tenant;

    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE_TENANT",
      resourceType: "tenant",
      resourceId: params.id,
    });

    return NextResponse.json(sanitized);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");
    await deleteTenant(params.id);

    await writeAuditLog({
      userId: session.user.id,
      action: "DELETE_TENANT",
      resourceType: "tenant",
      resourceId: params.id,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
