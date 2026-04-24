import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Users, ClipboardList, FolderKanban, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard — AuditFlow" }] }),
});

function StatCard({
  label,
  value,
  icon: Icon,
  to,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  to?: string;
}) {
  const inner = (
    <div
      className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-accent"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      {to && (
        <div className="mt-3 text-xs text-accent flex items-center gap-1">
          View <ArrowRight className="h-3 w-3" />
        </div>
      )}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function Dashboard() {
  const { user, hasRole, roles } = useAuth();
  const [stats, setStats] = useState({
    surveys: 0,
    drafts: 0,
    assigned: 0,
    completed: 0,
    groups: 0,
    users: 0,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const next = { ...stats };
      if (hasRole("lead_auditor")) {
        const { data: s } = await supabase
          .from("surveys")
          .select("id,status")
          .eq("lead_auditor_id", user.id);
        next.surveys = s?.length ?? 0;
        next.drafts = s?.filter((x) => x.status === "draft").length ?? 0;
      }
      if (hasRole("member_auditor")) {
        const { data: s } = await supabase.from("surveys").select("id").eq("status", "approved");
        next.assigned = s?.length ?? 0;
        const { data: r } = await supabase
          .from("survey_responses")
          .select("id,submitted")
          .eq("user_id", user.id);
        next.completed = r?.filter((x) => x.submitted).length ?? 0;
      }
      if (hasRole("admin")) {
        const { count: g } = await supabase
          .from("audit_groups")
          .select("*", { count: "exact", head: true });
        const { count: u } = await supabase
          .from("profiles")
          .select("*", { count: "exact", head: true });
        next.groups = g ?? 0;
        next.users = u ?? 0;
      }
      setStats(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, roles.join(",")]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your audit activity.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {hasRole("admin") && (
          <>
            <StatCard label="Users" value={stats.users} icon={Users} to="/admin/users" />
            <StatCard label="Audit groups" value={stats.groups} icon={FolderKanban} to="/admin/groups" />
          </>
        )}
        {hasRole("lead_auditor") && (
          <>
            <StatCard label="My surveys" value={stats.surveys} icon={FileText} to="/surveys" />
            <StatCard label="Drafts" value={stats.drafts} icon={FileText} to="/surveys" />
          </>
        )}
        {hasRole("member_auditor") && (
          <>
            <StatCard label="Assigned audits" value={stats.assigned} icon={ClipboardList} to="/assigned" />
            <StatCard label="Completed" value={stats.completed} icon={ClipboardList} to="/assigned" />
          </>
        )}
      </div>

      <div className="mt-10">
        <h2 className="font-semibold tracking-tight mb-3">Your roles</h2>
        <div className="flex flex-wrap gap-2">
          {roles.length === 0 && <span className="text-sm text-muted-foreground">No roles assigned</span>}
          {roles.map((r) => (
            <span
              key={r}
              className="rounded-full bg-secondary text-secondary-foreground text-xs px-3 py-1 capitalize"
            >
              {r.replace("_", " ")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}