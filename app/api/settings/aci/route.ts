import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { invalidateAciConfigCache } from "@/lib/db/settings";

export async function GET(req: Request) {
  try {
    await requireRole("SUPER_ADMIN");

    const config = await prisma.aciConfig.findFirst();
    return NextResponse.json(config || {});
  } catch (err: any) {
    if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GetAciConfig] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN");
    const body = await req.json();

    const { subscriptionId, resourceGroup, location } = body;

    if (!subscriptionId || !resourceGroup || !location) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const existing = await prisma.aciConfig.findFirst();

    let config;
    if (existing) {
      config = await prisma.aciConfig.update({
        where: { id: existing.id },
        data: { subscriptionId, resourceGroup, location, updatedById: session.user.id }
      });
    } else {
      config = await prisma.aciConfig.create({
        data: { subscriptionId, resourceGroup, location, updatedById: session.user.id }
      });
    }

    // Invalidate in-memory cache so worker picks up new config immediately
    invalidateAciConfigCache();

    return NextResponse.json({ success: true, config });
  } catch (err: any) {
    if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[UpdateAciConfig] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
