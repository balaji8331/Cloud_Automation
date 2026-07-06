"use client";
/**
 * AuthGuard — wraps authenticated layouts.
 * Shows a spinner while session is loading, redirects to /login if unauthenticated.
 * This prevents ALL child components from mounting and firing API calls before
 * the session is confirmed, which was the root cause of the 401 flood on page load.
 */
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Cloud } from "lucide-react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 animate-pulse">
            <Cloud className="h-6 w-6 text-white" />
          </div>
          <p className="text-sm text-gray-400">Loading…</p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null; // redirect in progress
  }

  return <>{children}</>;
}
