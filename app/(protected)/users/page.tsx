"use client";
import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, BadgeVariant } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { UserFormDialog } from "./UserFormDialog";
import { useSession } from "next-auth/react";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "FINANCE" | "READONLY";
  createdAt: string;
}

const roleVariant: Record<User["role"], BadgeVariant> = {
  SUPER_ADMIN: "danger",
  ADMIN: "default",
  FINANCE: "warning",
  READONLY: "outline",
};

const roleLabel: Record<User["role"], string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  FINANCE: "Finance",
  READONLY: "Read-only",
};

export default function UsersPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);

  const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/users");
    setUsers(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleDelete(id: string) {
    if (id === session?.user?.id) {
      toast({ variant: "destructive", title: "Cannot delete your own account" });
      return;
    }
    if (!confirm("Delete this user?")) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast({ variant: "success", title: "User deleted" });
      fetchUsers();
    } else {
      toast({ variant: "destructive", title: "Delete failed" });
    }
  }

  async function handlePromote(user: User) {
    if (!confirm(`Promote ${user.name ?? user.email} to SUPER_ADMIN?\n\nThis grants full terminal access to live Azure resources. This action is logged.`)) return;
    setPromoting(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}/promote`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Promotion failed", description: data.error });
        return;
      }
      toast({ variant: "success", title: `${user.name ?? user.email} promoted to Super Admin` });
      fetchUsers();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setPromoting(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Manage portal access and roles.
        </p>
        <Button onClick={() => { setEditingUser(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4" />
          Add User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users <span className="text-sm font-normal text-gray-500 ml-1">({users.length})</span></CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">User</th>
                  <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Role</th>
                  <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Joined</th>
                  <th className="pb-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="py-4 pr-4">
                      <p className="font-medium text-gray-900">{user.name ?? "—"}</p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                    </td>
                    <td className="py-4 pr-4">
                      <Badge variant={roleVariant[user.role]}>{roleLabel[user.role]}</Badge>
                    </td>
                    <td className="py-4 pr-4 text-xs text-gray-500">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="py-4">
                      <div className="flex items-center gap-1.5">
                        {/* Promote to Super Admin — only visible when viewer is SUPER_ADMIN */}
                        {isSuperAdmin && user.role !== "SUPER_ADMIN" && user.id !== session?.user?.id && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handlePromote(user)}
                            disabled={promoting === user.id}
                            aria-label="Promote to Super Admin"
                            title="Promote to Super Admin"
                            className="text-orange-500 hover:text-orange-700 hover:bg-orange-50"
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {/* Edit — hidden for SUPER_ADMIN targets */}
                        {user.role !== "SUPER_ADMIN" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => { setEditingUser(user); setDialogOpen(true); }}
                            aria-label="Edit user"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDelete(user.id)}
                          disabled={user.id === session?.user?.id}
                          aria-label="Delete user"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <UserFormDialog
        open={dialogOpen}
        user={editingUser}
        onClose={() => setDialogOpen(false)}
        onSaved={() => { setDialogOpen(false); fetchUsers(); }}
      />
    </div>
  );
}
