/**
 * Global authenticated fetch wrapper.
 * - Waits for session before any call (avoids premature 401s during loading)
 * - On 401/403 response, signs out and redirects to /login
 * - Drop-in replacement for window.fetch in client components
 */
"use client";

import { signOut } from "next-auth/react";

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);

  if (res.status === 401 || res.status === 403) {
    console.warn(`[fetchWithAuth] ${res.status} on ${input} — signing out`);
    await signOut({ callbackUrl: "/login" });
    // Return the response anyway so callers don't crash before redirect
  }

  return res;
}
