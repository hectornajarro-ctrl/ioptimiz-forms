import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus } from "lucide-react";

type Role = "admin" | "lead_auditor" | "member_auditor";

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  roles: Role[];
}

const ALL_ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "lead_auditor", label: "Lead Auditor" },
  { value: "member_auditor", label: "Member Auditor" },
];

export const Route = createFileRoute("/_app/admin/users")({
  component: AdminUsers,
  head: () => ({ meta: [{ title: "Users — AuditFlow" }] }),
});

function AdminUsers() {
  const { hasRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ email: string; password: string; full_name: string; roles: Role[] }>({
    email: "", password: "", full_name: "", roles: ["member_auditor"],
  });

  useEffect(() => {
    if (!authLoading && !hasRole("admin")) navigate({ to: "/dashboard" });
  }, [authLoading, hasRole, navigate]);

  const load = async () => {
    setLoading(true);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id,email,full_name")
      .order("created_at", { ascending: false });
    const { data: ur } = await supabase.from("user_roles").select("user_id,role");
    const map: Record<string, Role[]> = {};
    ur?.forEach((r) => {
      map[r.user_id] = [...(map[r.user_id] ?? []), r.role as Role];
    });
    setRows((profiles ?? []).map((p) => ({ ...p, roles: map[p.id] ?? [] })));
    setLoading(false);
  };

  useEffect(() => {
    if (hasRole("admin")) load();
  }, [hasRole]);

  const toggleRole = async (userId: string, role: Role, checked: boolean) => {
    if (checked) {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", role);
      if (error) return toast.error(error.message);
    }
    toast.success("Role updated");
    load();
  };

  const createUser = async () => {
    if (!form.email || form.password.length < 6) {
      return toast.error("Email and a password (min 6 chars) are required");
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: form,
    });
    setCreating(false);
    if (error) return toast.error(error.message);
    if (data?.error) return toast.error(data.error);
    toast.success("User created");
    setOpen(false);
    setForm({ email: "", password: "", full_name: "", roles: ["member_auditor"] });
    load();
  };

  const toggleNewUserRole = (role: Role, checked: boolean) => {
    setForm((f) => ({
      ...f,
      roles: checked ? [...f.roles, role] : f.roles.filter((r) => r !== role),
    }));
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight mb-2">Users</h1>
          <p className="text-muted-foreground">
            Provision new accounts and manage roles. Only System Administrators can create users.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><UserPlus className="h-4 w-4 mr-2" /> Create user</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a new user</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="nu-name">Full name</Label>
                <Input id="nu-name" value={form.full_name} maxLength={100}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nu-email">Email</Label>
                <Input id="nu-email" type="email" required value={form.email} maxLength={255}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nu-pw">Temporary password</Label>
                <Input id="nu-pw" type="text" required minLength={6} value={form.password} maxLength={128}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <p className="text-xs text-muted-foreground">Share this with the user; they can change it after signing in.</p>
              </div>
              <div className="space-y-2">
                <Label>Roles</Label>
                <div className="flex flex-col gap-2">
                  {ALL_ROLES.map((r) => (
                    <label key={r.value} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.roles.includes(r.value)}
                        onCheckedChange={(c) => toggleNewUserRole(r.value, c === true)}
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>Cancel</Button>
              <Button onClick={createUser} disabled={creating}>
                {creating ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              {ALL_ROLES.map((r) => (
                <TableHead key={r.value} className="text-center">{r.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No users yet</TableCell></TableRow>
            ) : rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                {ALL_ROLES.map((r) => (
                  <TableCell key={r.value} className="text-center">
                    <Checkbox
                      checked={u.roles.includes(r.value)}
                      onCheckedChange={(c) => toggleRole(u.id, r.value, c === true)}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-6">
        <Button variant="outline" onClick={load}>Refresh</Button>
      </div>
    </div>
  );
}