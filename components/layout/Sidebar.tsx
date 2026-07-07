"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  PiggyBank,
  Users,
  FileText,
  LogOut,
  Cloud,
  Server,
  Zap,
  Terminal,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Badge, BadgeVariant } from "@/components/ui/badge";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tenants", label: "Tenants", icon: Building2, adminOnly: true },
  { href: "/resources", label: "Resources", icon: Server },
  { href: "/automation", label: "Automation", icon: Zap, adminOnly: true },
  { href: "/budgets", label: "Budgets", icon: PiggyBank },
  { href: "/reports", label: "Reports", icon: FileText, financeOnly: true },
  { href: "/users", label: "Users", icon: Users, adminOnly: true },
  // Super Admin exclusive
  { href: "/terminal", label: "Terminal", icon: Terminal, superAdminOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isSuperAdmin = role === "SUPER_ADMIN";

  const visible = navItems.filter((item) => {
    // superAdminOnly items — only SUPER_ADMIN sees them
    if (item.superAdminOnly && !isSuperAdmin) return false;
    // adminOnly items — ADMIN and SUPER_ADMIN both see them (no change for ADMIN)
    if (item.adminOnly && role !== "ADMIN" && !isSuperAdmin) return false;
    // financeOnly items — hide from READONLY only
    if (item.financeOnly && role === "READONLY") return false;
    return true;
  });

  const roleBadgeVariant: BadgeVariant =
    isSuperAdmin
      ? "danger"
      : role === "ADMIN"
      ? "default"
      : role === "FINANCE"
      ? "warning"
      : "outline";

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
          const isTerminal = item.href === "/terminal";
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? isTerminal
                    ? "bg-orange-600 text-white"
                    : "bg-blue-600 text-white"
                  : isTerminal
                  ? "text-orange-400 hover:bg-orange-900/30 hover:text-orange-300"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
              {isTerminal && (
                <span className="ml-auto text-[9px] font-bold tracking-wider text-orange-400 uppercase">
                  Root
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-gray-800 p-4">
        <div className="mb-3 flex items-center gap-3">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold uppercase",
              isSuperAdmin ? "bg-orange-600" : "bg-blue-600"
            )}
          >
            {session?.user?.name?.[0] ?? session?.user?.email?.[0] ?? "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">
              {session?.user?.name ?? session?.user?.email}
            </p>
            {role && (
              <Badge
                variant={roleBadgeVariant}
                className="mt-0.5 text-[10px]"
              >
                {isSuperAdmin ? "Super Admin" : role}
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
