/**
 * Next.js edge middleware — enforces authentication on all protected routes.
 * Runs before any page renders, so unauthenticated users are redirected to
 * /login immediately without receiving any page HTML.
 *
 * Public routes (login, auth API, static assets) are explicitly excluded.
 */
import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
});

// Apply middleware to all routes EXCEPT public ones
export const config = {
  matcher: [
    // Match everything EXCEPT: login, auth API, public cancel/approve links, static assets
    "/((?!login|api/auth|api/automation/cancel|api/automation/schedules/.*/approve|_next/static|_next/image|favicon.ico|sw.js).*)",
  ],
};
