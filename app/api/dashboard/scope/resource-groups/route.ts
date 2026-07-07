import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { getDateRange, type DateRange } from "@/lib/utils";

export async function GET(req: Request) {
  try {
    await requireRole("READONLY");

    const { searchParams } = new URL(req.url);
    const subscriptionId = searchParams.get("subscriptionId");
    
    if (!subscriptionId) {
      return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });
    }

    const range = (searchParams.get("range") ?? "30d") as DateRange;
    const customFrom = searchParams.get("from");
    const customTo = searchParams.get("to");

    const { from, to } = getDateRange(
      range,
      customFrom ? new Date(customFrom) : undefined,
      customTo ? new Date(customTo) : undefined
    );

    // Get distinct resource groups that have cost records in this subscription + date range
    const rows = await prisma.costRecord.groupBy({
      by: ["resourceGroup"],
      where: {
        subscriptionId,
        date: { gte: from, lte: to },
        resourceGroup: { not: null }
      },
      orderBy: { resourceGroup: "asc" },
    });

    // Map to simple string array and filter out any nulls just in case
    const resourceGroups = rows
      .map(r => r.resourceGroup)
      .filter((rg): rg is string => rg !== null);

    return NextResponse.json(resourceGroups);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
