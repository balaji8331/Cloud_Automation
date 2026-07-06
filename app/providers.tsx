"use client";
import { SessionProvider } from "next-auth/react";
import { ToastContextProvider } from "@/components/ui/toast";
import { TenantsProvider } from "@/lib/context/TenantsContext";
import { SyncEventProvider } from "@/lib/context/SyncEventContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={5 * 60} refetchOnWindowFocus={false}>
      <TenantsProvider>
        <SyncEventProvider>
          <ToastContextProvider>{children}</ToastContextProvider>
        </SyncEventProvider>
      </TenantsProvider>
    </SessionProvider>
  );
}
