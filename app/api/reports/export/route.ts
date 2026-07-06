/**
 * GET /api/reports/export?format=csv&tenantId=&from=&to=
 * Exports cost records as CSV.
 * PDF export is handled client-side via jsPDF.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getCostRecordsForExport } from "@/lib/db/costs";
import { writeAuditLog } from "@/lib/db/audit";
import { getDateRange } from "@/lib/utils";

export async function GET(req: Request) {
  try {
    const session = await requireRole("FINANCE");

    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") ?? "csv";
    const tenantId = searchParams.get("tenantId") ?? undefined;
    const subscriptionId = searchParams.get("subscriptionId") ?? undefined;
    const range = (searchParams.get("range") ?? "30d") as "7d" | "30d" | "90d" | "1y";
    const { from, to } = getDateRange(range);

    const records = await getCostRecordsForExport({
      tenantId,
      subscriptionId,
      from,
      to,
    });

    await writeAuditLog({
      userId: session.user.id,
      action: format === "csv" ? "EXPORT_CSV" : "EXPORT_PDF",
      metadata: { tenantId, range },
    });

    if (format === "csv") {
      const headers = [
        "Date", "Tenant", "Subscription ID", "Subscription Name",
        "Resource Group", "Service", "Original Cost", "Original Currency",
        "Cost (USD)", // normalized
      ];

      const rows = records.map((r) => [
        r.date.toISOString().split("T")[0],
        r.tenant.name,
        r.subscription.subscriptionId,
        r.subscription.subscriptionName ?? "",
        r.resourceGroup ?? "",
        r.serviceName ?? "",
        Number(r.cost).toFixed(6),
        r.currency,
        Number(r.normalizedCostUsd).toFixed(6),
      ]);

      const csv = [
        headers.join(","),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="azure-costs-${range}.csv"`,
        },
      });
    }

    // JSON for client-side PDF generation
    return NextResponse.json({
      records: records.map((r) => ({
        date: r.date.toISOString().split("T")[0],
        tenant: r.tenant.name,
        subscriptionId: r.subscription.subscriptionId,
        subscriptionName: r.subscription.subscriptionName ?? "",
        resourceGroup: r.resourceGroup ?? "",
        serviceName: r.serviceName ?? "",
        cost: Number(r.cost),
        currency: r.currency,
      })),
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
