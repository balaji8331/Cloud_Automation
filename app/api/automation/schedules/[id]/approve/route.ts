/**
 * Approve a deletion schedule for live runs.
 *
 * GET  ?token=xxx  — one-click approve from email link (no session required)
 *                    Validates signed token stored on the schedule.
 *                    Returns HTML confirmation page.
 *
 * POST (no token)  — approve from UI (requires active Admin session).
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";
import { ApprovalStatus } from "@prisma/client";

// ── GET — email link approval ─────────────────────────────────────────────────
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return new NextResponse("Missing token", { status: 400 });
  }

  const schedule = await prisma.deletionSchedule.findUnique({ where: { id: params.id } });

  if (!schedule) {
    return htmlPage("Not Found", "#ef4444", "Schedule not found.", null);
  }

  if (schedule.approveToken !== token) {
    return htmlPage("Invalid Link", "#ef4444", "This approval link is invalid or has already been used.", null);
  }

  if (schedule.approveTokenExpiresAt && schedule.approveTokenExpiresAt < new Date()) {
    return htmlPage("Link Expired", "#f59e0b",
      "This approval link has expired. A new dry run will be triggered automatically on the next poll cycle, generating a fresh link.",
      `${process.env.NEXTAUTH_URL}/automation`
    );
  }

  if (schedule.approvalStatus === ApprovalStatus.APPROVED) {
    return htmlPage("Already Approved", "#22c55e",
      `Schedule "${schedule.name}" is already approved and running automatically.`,
      `${process.env.NEXTAUTH_URL}/automation`
    );
  }

  // Approve
  await prisma.deletionSchedule.update({
    where: { id: params.id },
    data: {
      approvalStatus: ApprovalStatus.APPROVED,
      approveToken: null,       // consume the token — one-use only
      approveTokenExpiresAt: null,
    },
  });

  console.log(`[Approve] Schedule "${schedule.name}" approved via email link`);

  return htmlPage(
    "✓ Schedule Approved",
    "#16a34a",
    `<strong>"${schedule.name}"</strong> is now approved for live deletions.<br><br>
     It will run automatically on its configured schedule. You will receive a notification email
     before each execution with the option to cancel.`,
    `${process.env.NEXTAUTH_URL}/automation`
  );
}

// ── POST — UI approval (requires session) ─────────────────────────────────────
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole("ADMIN");

    const schedule = await prisma.deletionSchedule.findUnique({ where: { id: params.id } });
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

    // Must have completed a dry run first
    const dryRun = await prisma.deletionRun.findFirst({
      where: { scheduleId: params.id, status: "DRY_RUN" },
    });
    if (!dryRun) {
      return NextResponse.json(
        { error: "Cannot approve: schedule has not completed a dry run yet." },
        { status: 400 }
      );
    }

    await prisma.deletionSchedule.update({
      where: { id: params.id },
      data: {
        approvalStatus: ApprovalStatus.APPROVED,
        approveToken: null,
        approveTokenExpiresAt: null,
      },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "APPROVE_DELETION_SCHEDULE",
      resourceType: "deletion_schedule",
      resourceId: params.id,
      metadata: { scheduleName: schedule.name, approvedVia: "ui" },
    });

    return NextResponse.json({
      success: true,
      message: "Schedule approved. It will run automatically on its configured schedule.",
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function htmlPage(title: string, color: string, body: string, backUrl: string | null): NextResponse {
  const backLink = backUrl
    ? `<br><br><a href="${backUrl}" style="color:#2563eb;text-decoration:none">← Back to Automation</a>`
    : "";
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
    <body style="font-family:sans-serif;padding:60px 40px;max-width:560px;margin:0 auto">
      <h2 style="color:${color}">${title}</h2>
      <p style="color:#374151;line-height:1.6">${body}</p>
      ${backLink}
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}
