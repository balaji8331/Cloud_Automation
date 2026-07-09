import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("SUPER_ADMIN");

    const run = await prisma.scriptRun.findUnique({
      where: { id: params.id },
      include: {
        tenant: { select: { name: true } },
        triggeredBy: { select: { email: true, name: true } }
      }
    });

    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(run);
  } catch (err: any) {
    if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GetLogById] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole("SUPER_ADMIN");

    const run = await prisma.scriptRun.findUnique({ where: { id: params.id } });
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.scriptRun.delete({ where: { id: params.id } });

    // Optional: write audit log
    // ...

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[DeleteLogById] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
