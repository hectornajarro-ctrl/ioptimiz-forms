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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Users, Trash2, UserPlus } from "lucide-react";

interface AuditRow {
  id: string;
  name: string;
  description: string | null;
  lead_auditor_id: string;
  open_enrollment: boolean;
  lead_name?: string | null;
  member_count?: number;
}

interface UserOpt {
  id: string;
  email: string;
  full_name: string | null;
  roles: string[];
}

export const Route = createFileRoute("/_app/admin/audits")({
  component: AdminAudits,
  head: () => ({
    meta: [{ title: "Audits — AuditFlow" }],
  }),
});

function AdminAudits() {
  const { user, hasRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const isAdmin = hasRole("admin");
  const isLead = hasRole("lead_auditor");

  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AuditRow | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leadId, setLeadId] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [openEnrollment, setOpenEnrollment] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAdmin && !isLead) {
      navigate({ to: "/dashboard" });
    }
  }, [authLoading, isAdmin, isLead, navigate]);

  const load = async () => {
    const { data: auditRows, error: auditError } = await supabase
      .from("audits" as any)
      .select("id,name,description,lead_auditor_id,open_enrollment")
      .order("created_at", { ascending: false });

    if (auditError) {
      toast.error(auditError.message);
      return;
    }

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id,email,full_name");

    if (profilesError) {
      toast.error(profilesError.message);
      return;
    }

    const { data: userRoles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id,role");

    if (rolesError) {
      toast.error(rolesError.message);
      return;
    }

    const { data: members, error: membersError } = await supabase
      .from("audits_members" as any)
      .select("group_id,user_id");

    if (membersError) {
      toast.error(membersError.message);
      return;
    }

    const profMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

    const counts: Record<string, number> = {};
    ((members ?? []) as any[]).forEach((m) => {
      counts[m.group_id] = (counts[m.group_id] ?? 0) + 1;
    });

    const rolesMap: Record<string, string[]> = {};
    userRoles?.forEach((r) => {
      rolesMap[r.user_id] = [...(rolesMap[r.user_id] ?? []), r.role];
    });

    setAudits(
      ((auditRows ?? []) as any[]).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        lead_auditor_id: row.lead_auditor_id,
        open_enrollment: row.open_enrollment,
        lead_name:
          profMap.get(row.lead_auditor_id)?.full_name ||
          profMap.get(row.lead_auditor_id)?.email ||
          "—",
        member_count: counts[row.id] ?? 0,
      }))
    );

    setUsers(
      (profiles ?? []).map((p) => ({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        roles: rolesMap[p.id] ?? [],
      }))
    );
  };

  useEffect(() => {
    if (isAdmin || isLead) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isLead]);

  useEffect(() => {
    if (open && !editing && !isAdmin && user) {
      setLeadId(user.id);
    }
  }, [open, editing, isAdmin, user]);

  const resetForm = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setLeadId(isAdmin ? "" : user?.id ?? "");
    setMemberIds(new Set());
    setOpenEnrollment(false);
  };

  const openEdit = async (audit: AuditRow) => {
    if (!isAdmin && audit.lead_auditor_id !== user?.id) {
      return toast.error("You can only edit audits you lead");
    }

    setEditing(audit);
    setName(audit.name);
    setDescription(audit.description ?? "");
    setLeadId(audit.lead_auditor_id);
    setOpenEnrollment(!!audit.open_enrollment);

    const { data, error } = await supabase
      .from("audits_members" as any)
      .select("user_id")
      .eq("group_id", audit.id);

    if (error) {
      toast.error(error.message);
      return;
    }

    setMemberIds(new Set(((data ?? []) as any[]).map((d) => d.user_id)));
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim() || !leadId) {
      return toast.error("Name and Lead Auditor are required");
    }

    if (!user) return;

    if (!isAdmin && leadId !== user.id) {
      return toast.error("You can only create audits where you are the lead");
    }

    if (saving) return;

    setSaving(true);

    try {
      let auditId = editing?.id;

      if (editing) {
        const { error } = await supabase
          .from("audits" as any)
          .update({
            name: name.trim(),
            description: description.trim() || null,
            lead_auditor_id: leadId,
            open_enrollment: openEnrollment,
          })
          .eq("id", editing.id);

        if (error) {
          toast.error(error.message);
          return;
        }
      } else {
        const { data, error } = await supabase
          .from("audits" as any)
          .insert({
            name: name.trim(),
            description: description.trim() || null,
            lead_auditor_id: leadId,
            created_by: user.id,
            open_enrollment: openEnrollment,
          })
          .select("id")
          .single();

        if (error) {
          if ((error as { code?: string }).code === "23505") {
            toast.error(
              "An audit with this name already exists for this Lead Auditor"
            );
            return;
          }

          toast.error(error.message);
          return;
        }

        auditId = (data as any).id;
      }

      if (auditId) {
        await supabase
          .from("audits_members" as any)
          .delete()
          .eq("group_id", auditId);

        if (!openEnrollment) {
          const inserts = Array.from(memberIds).map((uid) => ({
            group_id: auditId!,
            user_id: uid,
          }));

          if (inserts.length > 0) {
            const { error } = await supabase
              .from("audits_members" as any)
              .insert(inserts);

            if (error) {
              toast.error(error.message);
              return;
            }
          }
        }
      }

      toast.success(editing ? "Audit updated" : "Audit created");
      setOpen(false);
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const target = audits.find((audit) => audit.id === id);

    if (!isAdmin && target && target.lead_auditor_id !== user?.id) {
      return toast.error("You can only delete audits you lead");
    }

    if (!confirm("Delete this audit? This cannot be undone.")) return;

    const { error } = await supabase
      .from("audits" as any)
      .delete()
      .eq("id", id);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Audit deleted");
    await load();
  };

  const leadOptions = users.filter((u) => u.roles.includes("lead_auditor"));
  const memberOptions = users.filter((u) => u.roles.includes("member_auditor"));

  const visibleAudits = isAdmin
    ? audits
    : audits.filter((audit) => audit.lead_auditor_id === user?.id);

  if (authLoading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="container mx-auto max-w-6xl py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audits</h1>

          <p className="text-muted-foreground mt-1">
            {isAdmin
              ? "Each audit has one Lead Auditor and several Member Auditors."
              : "Audits you lead. You can create new audits and manage their members."}
          </p>
        </div>

        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={resetForm}>
              <Plus className="h-4 w-4 mr-2" />
              New audit
            </Button>
          </DialogTrigger>

          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit audit" : "Create audit"}</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label>Audit name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder="Audit name"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  placeholder="Optional description"
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  Lead Auditor{" "}
                  {!isAdmin && (
                    <span className="text-xs text-muted-foreground font-normal">
                      (you)
                    </span>
                  )}
                </Label>

                <Select
                  value={leadId}
                  onValueChange={setLeadId}
                  disabled={!isAdmin}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a lead auditor" />
                  </SelectTrigger>

                  <SelectContent>
                    {leadOptions.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        No lead auditors. Assign role on Users page.
                      </div>
                    )}

                    {leadOptions.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name || u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50">
                <Checkbox
                  checked={openEnrollment}
                  onCheckedChange={(checked) =>
                    setOpenEnrollment(checked === true)
                  }
                  className="mt-0.5"
                />

                <div className="text-sm">
                  <div className="font-medium flex items-center gap-1.5">
                    <UserPlus className="h-4 w-4" />
                    Open enrollment — no designated members
                  </div>

                  <div className="text-xs text-muted-foreground mt-1">
                    Any member auditor can pick an assigned survey from this
                    audit. The first one to take it becomes the sole member; no
                    one else can take it after that.
                  </div>
                </div>
              </label>

              <div className="space-y-1.5">
                <Label>
                  Members{" "}
                  {openEnrollment && (
                    <span className="text-xs text-muted-foreground font-normal">
                      (disabled — open enrollment)
                    </span>
                  )}
                </Label>

                <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                  {memberOptions.length === 0 && (
                    <div className="px-3 py-3 text-sm text-muted-foreground">
                      No member auditors yet.
                    </div>
                  )}

                  {memberOptions.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted"
                    >
                      <Checkbox
                        checked={memberIds.has(u.id)}
                        disabled={openEnrollment}
                        onCheckedChange={(checked) => {
                          const next = new Set(memberIds);

                          if (checked === true) {
                            next.add(u.id);
                          } else {
                            next.delete(u.id);
                          }

                          setMemberIds(next);
                        }}
                      />

                      <div className="text-sm">
                        <div>{u.full_name || u.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {u.email}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <Button onClick={save} disabled={saving} className="w-full">
                {saving
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Create audit"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleAudits.length === 0 && (
          <div className="col-span-full text-center text-muted-foreground py-12 border border-dashed rounded-lg">
            No audits yet. Create your first audit to get started.
          </div>
        )}

        {visibleAudits.map((audit) => {
          const canManage = isAdmin || audit.lead_auditor_id === user?.id;

          return (
            <div
              key={audit.id}
              className="rounded-lg border border-border bg-card p-5"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold tracking-tight">
                    {audit.name}
                  </div>

                  <div className="text-xs text-muted-foreground mt-1">
                    Lead: {audit.lead_name}
                  </div>

                  {audit.open_enrollment && (
                    <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">
                      <UserPlus className="h-3 w-3" />
                      Open enrollment
                    </div>
                  )}
                </div>

                {canManage && (
                  <button
                    onClick={() => remove(audit.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              {audit.description && (
                <p className="text-sm text-muted-foreground mt-3">
                  {audit.description}
                </p>
              )}

              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {audit.open_enrollment
                    ? audit.member_count === 0
                      ? "Unclaimed"
                      : "Claimed by 1 member"
                    : `${audit.member_count} member${
                        audit.member_count === 1 ? "" : "s"
                      }`}
                </div>

                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(audit)}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
