import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";

export async function GET(req: Request) {
  try {
    await requireRole("READONLY");

    const presets = await prisma.vmConfigPreset.findMany({
      orderBy: { vcpus: "asc" },
    });

    return NextResponse.json(presets);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as any).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
