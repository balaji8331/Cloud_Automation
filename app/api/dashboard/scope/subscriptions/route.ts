import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";

export async function GET(req: Request) {
  try {
    await requireRole("READONLY");

    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
    }

    const subscriptions = await prisma.subscription.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, subscriptionId: true, subscriptionName: true },
      orderBy: { subscriptionName: "asc" },
    });

    return NextResponse.json(subscriptions);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
