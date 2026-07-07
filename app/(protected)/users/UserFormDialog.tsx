"use client";
import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "FINANCE" | "READONLY";
}

interface UserFormDialogProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}

export function UserFormDialog({ open, user, onClose, onSaved }: UserFormDialogProps) {
  const { toast } = useToast();
  const isEdit = !!user;

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "FINANCE" | "READONLY">("READONLY");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setName(user.name ?? "");
      // SUPER_ADMIN users are never edited via this dialog (Edit button is hidden for them)
      setRole((user.role === "SUPER_ADMIN" ? "ADMIN" : user.role) as "ADMIN" | "FINANCE" | "READONLY");
      setPassword("");
    } else {
      setEmail(""); setName(""); setPassword(""); setRole("READONLY");
    }
  }, [user, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const body: Record<string, string> = { role };
    if (!isEdit) { body.email = email; body.password = password; }
    if (name) body.name = name;

    const url = isEdit ? `/api/users/${user.id}` : "/api/users";
    const method = isEdit ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Save failed", description: data.error });
        return;
      }
      toast({ variant: "success", title: isEdit ? "User updated" : "User created" });
      onSaved();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit User" : "Add User"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          )}
          <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          {!isEdit && (
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          )}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Role</label>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="READONLY">Read-only — view dashboards</SelectItem>
                <SelectItem value="FINANCE">Finance — view + export reports</SelectItem>
                <SelectItem value="ADMIN">Admin — full access</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>{isEdit ? "Save changes" : "Create user"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
