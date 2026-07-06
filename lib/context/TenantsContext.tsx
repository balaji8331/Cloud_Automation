"use client";
/**
 * Global tenants cache — fetches once per session, shared across all components.
 * Prevents GlobalSyncButton + other consumers from firing duplicate /api/tenants calls.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { fetchWithAuth } from "@/lib/auth/fetchWithAuth";

interface Tenant {
  id: string;
  name: string;
  status: "PENDING" | "CONNECTED" | "ERROR";
}

interface TenantsContextValue {
  tenants: Tenant[];
  loading: boolean;
  refresh: () => void;
}

const TenantsContext = createContext<TenantsContextValue>({
  tenants: [],
  loading: false,
  refresh: () => {},
});

export function TenantsProvider({ children }: { children: ReactNode }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const { status } = useSession();

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/tenants");
      const data = await res.json();
      setTenants(Array.isArray(data) ? data : []);
      setFetched(true);
    } catch (e) {
      console.error("[TenantsContext]", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Only fetch when session is authenticated — prevents premature 401s
  useEffect(() => {
    if (status === "authenticated" && !fetched) fetchTenants();
  }, [status, fetched, fetchTenants]);

  return (
    <TenantsContext.Provider value={{ tenants, loading, refresh: fetchTenants }}>
      {children}
    </TenantsContext.Provider>
  );
}

export function useTenants() {
  return useContext(TenantsContext);
}
