"use client";
/**
 * SyncEventContext — lets GlobalSyncButton broadcast "sync complete"
 * so any page that cares (dashboard, budgets) can auto-refresh its data.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface SyncEventContextValue {
  lastSyncAt: number; // epoch ms — increment to trigger re-fetch in consumers
  notifySyncComplete: () => void;
}

const SyncEventContext = createContext<SyncEventContextValue>({
  lastSyncAt: 0,
  notifySyncComplete: () => {},
});

export function SyncEventProvider({ children }: { children: ReactNode }) {
  const [lastSyncAt, setLastSyncAt] = useState(0);

  const notifySyncComplete = useCallback(() => {
    setLastSyncAt(Date.now());
  }, []);

  return (
    <SyncEventContext.Provider value={{ lastSyncAt, notifySyncComplete }}>
      {children}
    </SyncEventContext.Provider>
  );
}

export function useSyncEvent() {
  return useContext(SyncEventContext);
}
