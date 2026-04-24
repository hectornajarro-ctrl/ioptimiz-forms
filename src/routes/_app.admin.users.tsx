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

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Users</h1>
      <p className="text-muted-foreground mb-6">
        Manage roles for everyone in the platform. New signups get Member Auditor by default.
      </p>

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