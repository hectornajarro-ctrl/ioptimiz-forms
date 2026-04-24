import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Users, Trash2 } from "lucide-react";

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  lead_auditor_id: string;
  lead_name?: string | null;
  member_count?: number;
}

interface UserOpt {
  id: string;
  email: string;
  full_name: string | null;
  roles: string[];
}

export const Route = createFileRoute("/_app/admin/groups")({
  component: AdminGroups,
  head: () => ({ meta: [{ title: "Audit Groups — AuditFlow" }] }),
});

function AdminGroups() {
  const { user, hasRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leadId, setLeadId] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!authLoading && !hasRole("admin")) navigate({ to: "/dashboard" });
  }, [authLoading, hasRole, navigate]);

  const load = async () => {
    const { data: g } = await supabase.from("audit_groups").select("id,name,description,lead_auditor_id");
    const { data: profiles } = await supabase.from("profiles").select("id,email,full_name");
    const { data: ur } = await supabase.from("user_roles").select("user_id,role");
    const { data: members } = await supabase.from("audit_group_members").select("group_id,user_id");
    const profMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);
    const counts: Record<string, number> = {};
    members?.forEach((m) => { counts[m.group_id] = (counts[m.group_id] ?? 0) + 1; });
    const rolesMap: Record<string, string[]> = {};
    ur?.forEach((r) => { rolesMap[r.user_id] = [...(rolesMap[r.user_id] ?? []), r.role]; });
    setGroups((g ?? []).map((row) => ({
      ...row,
      lead_name: profMap.get(row.lead_auditor_id)?.full_name || profMap.get(row.lead_auditor_id)?.email || "—",
      member_count: counts[row.id] ?? 0,
    })));
    setUsers((profiles ?? []).map((p) => ({ ...p, roles: rolesMap[p.id] ?? [] })));
  };

  useEffect(() => { if (hasRole("admin")) load(); }, [hasRole]);

  const resetForm = () => {
    setEditing(null);
    setName(""); setDescription(""); setLeadId(""); setMemberIds(new Set());
  };

  const openEdit = async (g: GroupRow) => {
    setEditing(g);
    setName(g.name);
    setDescription(g.description ?? "");
    setLeadId(g.lead_auditor_id);
    const { data } = await supabase.from("audit_group_members").select("user_id").eq("group_id", g.id);
    setMemberIds(new Set(data?.map((d) => d.user_id) ?? []));
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim() || !leadId) return toast.error("Name and Lead Auditor are required");
    if (!user) return;
    let groupId = editing?.id;
    if (editing) {
      const { error } = await supabase
        .from("audit_groups")
        .update({ name: name.trim(), description: description.trim() || null, lead_auditor_id: leadId })
        .eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { data, error } = await supabase
        .from("audit_groups")
        .insert({ name: name.trim(), description: description.trim() || null, lead_auditor_id: leadId, created_by: user.id })
        .select("id").single();
      if (error) return toast.error(error.message);
      groupId = data.id;
    }
    if (groupId) {
      await supabase.from("audit_group_members").delete().eq("group_id", groupId);
      const inserts = Array.from(memberIds).map((uid) => ({ group_id: groupId!, user_id: uid }));
      if (inserts.length > 0) {
        const { error } = await supabase.from("audit_group_members").insert(inserts);
        if (error) return toast.error(error.message);
      }
    }
    toast.success(editing ? "Group updated" : "Group created");
    setOpen(false);
    resetForm();
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this group? This cannot be undone.")) return;
    const { error } = await supabase.from("audit_groups").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Group deleted");
    load();
  };

  const leadOptions = users.filter((u) => u.roles.includes("lead_auditor"));
  const memberOptions = users.filter((u) => u.roles.includes("member_auditor"));

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Audit Groups</h1>
          <p className="text-muted-foreground mt-1">Each group has one Lead Auditor and several Member Auditors.</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> New group</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit group" : "Create audit group"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
              </div>
              <div className="space-y-1.5">
                <Label>Lead Auditor</Label>
                <Select value={leadId} onValueChange={setLeadId}>
                  <SelectTrigger><SelectValue placeholder="Select a lead auditor" /></SelectTrigger>
                  <SelectContent>
                    {leadOptions.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No lead auditors. Assign role on Users page.</div>}
                    {leadOptions.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Members</Label>
                <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                  {memberOptions.length === 0 && <div className="px-3 py-3 text-sm text-muted-foreground">No member auditors yet.</div>}
                  {memberOptions.map((u) => (
                    <label key={u.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted">
                      <Checkbox
                        checked={memberIds.has(u.id)}
                        onCheckedChange={(c) => {
                          const next = new Set(memberIds);
                          if (c === true) next.add(u.id); else next.delete(u.id);
                          setMemberIds(next);
                        }}
                      />
                      <div className="text-sm">
                        <div>{u.full_name || u.email}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <Button onClick={save} className="w-full">{editing ? "Save changes" : "Create group"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.length === 0 && (
          <div className="col-span-full text-center text-muted-foreground py-12 border border-dashed rounded-lg">
            No groups yet. Create your first audit group to get started.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.id} className="rounded-lg border border-border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold tracking-tight">{g.name}</div>
                <div className="text-xs text-muted-foreground mt-1">Lead: {g.lead_name}</div>
              </div>
              <button onClick={() => remove(g.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {g.description && <p className="text-sm text-muted-foreground mt-3">{g.description}</p>}
            <div className="mt-4 flex items-center justify-between">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" /> {g.member_count} member{g.member_count === 1 ? "" : "s"}
              </div>
              <Button variant="outline" size="sm" onClick={() => openEdit(g)}>Edit</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}