"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  PiggyBank,
  Users,
  FileText,
  Settings,
  LogOut,
  Cloud,
  Server,
  Zap,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tenants", label: "Tenants", icon: Building2, adminOnly: true },
  { href: "/resources", label: "Resources", icon: Server },
  { href: "/automation", label: "Automation", icon: Zap, adminOnly: true },
  { href: "/budgets", label: "Budgets", icon: PiggyBank },
  { href: "/reports", label: "Reports", icon: FileText, financeOnly: true },
  { href: "/users", label: "Users", icon: Users, adminOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role;

  const visible = navItems.filter((item) => {
    if (item.adminOnly && role !== "ADMIN") return false;
    if (item.financeOnly && role === "READONLY") return false;
    return true;
  });

  return (
    <aside className="flex h-full w-60 flex-col border-r border-gray-200 bg-gray-950 text-white">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-5 border-b border-gray-800">
        <Cloud className="h-6 w-6 text-blue-400" />
        <span className="font-semibold text-sm tracking-tight">Azure Cost Portal</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5" aria-label="Main navigation">
        {visible.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-gray-800 p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold uppercase">
            {session?.user?.name?.[0] ?? session?.user?.email?.[0] ?? "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">
              {session?.user?.name ?? session?.user?.email}
            </p>
            {role && (
              <Badge
                variant={role === "ADMIN" ? "default" : role === "FINANCE" ? "warning" : "outline"}
                className="mt-0.5 text-[10px]"
              >
                {role}
              </Badge>
            )}
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
