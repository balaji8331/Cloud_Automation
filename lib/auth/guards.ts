/**
 * Server-side auth guards for API routes.
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

/** Returns the session or throws a 401 NextResponse */
export async function requireAuth(): Promise<AppSession> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new AuthError(401, "Unauthorized");
  }
  return session as AppSession;
}

/** Require a minimum role level */
export async function requireRole(
  minRole: UserRole
): Promise<AppSession> {
  const session = await requireAuth();
  const order: UserRole[] = ["READONLY", "FINANCE", "ADMIN"];
  const userLevel = order.indexOf(session.user.role);
  const requiredLevel = order.indexOf(minRole);

  if (userLevel < requiredLevel) {
    throw new AuthError(403, "Forbidden: insufficient role");
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
