/**
 * GET /api/automation/cancel?token=xxx
 * Public cancel link sent in pre-execution emails.
 * Sets deletion_run status to CANCELLED if not yet executing.
 */
import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return new NextResponse("Missing cancel token", { status: 400 });
  }

  const run = await prisma.deletionRun.findUnique({ where: { cancelToken: token } });
  if (!run) {
    return new NextResponse("Invalid or expired cancel token", { status: 404 });
  }

  if (run.status === "EXECUTING" || run.status === "COMPLETED" || run.status === "FAILED") {
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:#ef4444">Cannot Cancel</h2>
        <p>This deletion run is already <strong>${run.status.toLowerCase()}</strong> and cannot be cancelled.</p>
      </body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  if (run.status === "CANCELLED") {
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:#6b7280">Already Cancelled</h2>
        <p>This deletion run was already cancelled.</p>
      </body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  await prisma.deletionRun.update({
    where: { id: run.id },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  return new NextResponse(
    `<html><body style="font-family:sans-serif;padding:40px">
      <h2 style="color:#22c55e">✅ Run Cancelled</h2>
      <p>The scheduled deletion run has been cancelled successfully.</p>
      <p>No resources were deleted.</p>
      <a href="${process.env.NEXTAUTH_URL}/automation" style="color:#2563eb">Back to Automation</a>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}
