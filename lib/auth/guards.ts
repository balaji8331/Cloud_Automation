/**
 * Server-side auth guards for API routes.
 *
 * Role hierarchy (ascending privilege):
 *   READONLY < FINANCE < ADMIN < SUPER_ADMIN
 *
 * Usage:
 *   requireRole("ADMIN")           — passes for ADMIN + SUPER_ADMIN (hierarchy)
 *   requireRole(["SUPER_ADMIN"])   — passes ONLY for SUPER_ADMIN (exact allow-list)
 *
 * All existing requireRole("ADMIN") call-sites continue to work identically
 * for ADMIN users. SUPER_ADMIN passes them automatically because it sits
 * above ADMIN in the hierarchy.
 */
import { getServerSession } from "next-auth";
import { authOptions } from "./config";
import type { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";

export interface AppSession {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role: UserRole;
  };
}

/** Full role hierarchy — lowest to highest privilege */
const ROLE_ORDER: UserRole[] = ["READONLY", "FINANCE", "ADMIN", "SUPER_ADMIN"];

/** Returns the session or throws AuthError(401) */
export async function requireAuth(): Promise<AppSession> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new AuthError(401, "Unauthorized");
  }
  return session as AppSession;
}

/**
 * requireRole(minRole)          — hierarchy check: user must be >= minRole
 * requireRole([role1, role2])   — exact allow-list: user.role must be in the array
 *
 * Existing callers using the string form are completely unaffected.
 */
export async function requireRole(
  minRoleOrAllowList: UserRole | UserRole[]
): Promise<AppSession> {
  const session = await requireAuth();
  const userRole = session.user.role;

  if (Array.isArray(minRoleOrAllowList)) {
    // Exact allow-list mode (used for SUPER_ADMIN-only routes)
    if (!minRoleOrAllowList.includes(userRole)) {
      throw new AuthError(403, "Forbidden: insufficient role");
    }
  } else {
    // Hierarchy mode — unchanged behaviour for all existing call-sites
    const userLevel = ROLE_ORDER.indexOf(userRole);
    const requiredLevel = ROLE_ORDER.indexOf(minRoleOrAllowList);
    if (userLevel < requiredLevel) {
      throw new AuthError(403, "Forbidden: insufficient role");
    }
  }

  return session;
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Wrap an API handler with auth error handling */
export function withAuth(
  handler: (req: Request) => Promise<NextResponse>
): (req: Request) => Promise<NextResponse> {
  return async (req) => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  };
}
