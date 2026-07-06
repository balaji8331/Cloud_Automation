"use client";
import { Bell } from "lucide-react";
import { usePathname } from "next/navigation";
import { GlobalSyncButton } from "./GlobalSyncButton";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/tenants": "Tenants",
  "/resources": "Resource Inventory",
  "/automation": "Automation",
  "/budgets": "Budgets",
  "/reports": "Reports",
  "/users": "Users",
};

export function Header() {
  const pathname = usePathname();
  const title =
    Object.entries(pageTitles).find(([path]) => pathname.startsWith(path))?.[1] ??
    "Azure Cost Portal";

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      <h1 className="text-base font-semibold text-gray-900">{title}</h1>
      <div className="flex items-center gap-3">
        <GlobalSyncButton />
        <button
          className="relative rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
