/**
 * Next.js edge middleware — enforces authentication on all protected routes.
 * Runs before any page renders, so unauthenticated users are redirected to
 * /login immediately without receiving any page HTML.
 *
 * Public routes (login, auth API, static assets) are explicitly excluded.
 */
import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    // If authenticated, allow the request through
    return NextResponse.next();
  },
  {
    callbacks: {
      // Return true = allow, false = redirect to signIn page
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

// Apply middleware to all routes EXCEPT public ones
export const config = {
  matcher: [
    // Match everything EXCEPT: login, auth API, public cancel/approve links, static assets
    "/((?!login|api/auth|api/automation/cancel|api/automation/schedules/.*/approve|_next/static|_next/image|favicon.ico|sw.js).*)",
  ],
};
