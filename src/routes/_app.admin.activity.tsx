import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { History, RefreshCw, Plus, Pencil, Trash2 } from "lucide-react";

interface LogRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: "create" | "update" | "delete";
  entity_type: "user" | "group" | "survey";
  entity_id: string | null;
  summary: string | null;
  created_at: string;
}

export const Route = createFileRoute("/_app/admin/activity")({
  component: AdminActivity,
  head: () => ({ meta: [{ title: "Activity Log — AuditFlow" }] }),
});

function AdminActivity() {
  const { hasRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState<string>("all");
  const [action, setAction] = useState<string>("all");

  useEffect(() => {
    if (!authLoading && !hasRole("admin")) navigate({ to: "/dashboard" });
  }, [authLoading, hasRole, navigate]);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("audit_logs")
      .select("id,actor_id,actor_email,action,entity_type,entity_id,summary,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (entity !== "all") q = q.eq("entity_type", entity);
    if (action !== "all") q = q.eq("action", action);
    const { data } = await q;
    setRows((data ?? []) as LogRow[]);
    setLoading(false);
  };

  useEffect(() => { if (hasRole("admin")) load(); }, [hasRole, entity, action]);

  const actionBadge = (a: LogRow["action"]) => {
    const map = {
      create: { bg: "bg-success/15", text: "text-success", icon: Plus, label: "Create" },
      update: { bg: "bg-accent/15", text: "text-accent-foreground", icon: Pencil, label: "Update" },
      delete: { bg: "bg-destructive/15", text: "text-destructive", icon: Trash2, label: "Delete" },
    } as const;
    const v = map[a];
    const Icon = v.icon;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${v.bg} ${v.text}`}>
        <Icon className="h-3 w-3" /> {v.label}
      </span>
    );
  };

  const entityLabel = (e: LogRow["entity_type"]) => {
    const m: Record<string, string> = { user: "User", group: "Group", survey: "Survey" };
    return m[e] ?? e;
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight mb-2 inline-flex items-center gap-2">
            <History className="h-7 w-7" /> Activity Log
          </h1>
          <p className="text-muted-foreground">
            Audit trail of all create, update, and delete actions on users, groups, and surveys.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Entity</div>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="user">Users</SelectItem>
                <SelectItem value="group">Groups</SelectItem>
                <SelectItem value="survey">Surveys</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Action</div>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={load} className="h-9">
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">When</TableHead>
              <TableHead className="w-32">Action</TableHead>
              <TableHead className="w-28">Entity</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Actor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">No activity yet.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </TableCell>
                <TableCell>{actionBadge(r.action)}</TableCell>
                <TableCell className="text-sm">{entityLabel(r.entity_type)}</TableCell>
                <TableCell className="text-sm">{r.summary ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.actor_email ?? "system"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
