import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { ClipboardList, CheckCircle2, Clock, UserPlus, CalendarClock, CalendarX } from "lucide-react";

interface AssignedSurvey {
  id: string;
  title: string;
  description: string | null;
  approved_at: string | null;
  progress: number;
  submitted: boolean;
  open: boolean;
  starts_at: string | null;
  ends_at: string | null;
  notYetOpen: boolean;
  closed: boolean;
}

export const Route = createFileRoute("/_app/assigned")({
  component: AssignedAudits,
  head: () => ({ meta: [{ title: "Assigned audits — AuditFlow" }] }),
});

function AssignedAudits() {
  const { user } = useAuth();
  const location = useLocation();
  const [rows, setRows] = useState<AssignedSurvey[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: surveys } = await supabase
        .from("surveys")
        .select("id,title,description,approved_at,assigned_group_id,starts_at,ends_at")
        .eq("status", "approved")
        .order("approved_at", { ascending: false });
      const { data: responses } = await supabase
        .from("survey_responses")
        .select("survey_id,progress,submitted")
        .eq("user_id", user.id);
      const groupIds = Array.from(new Set((surveys ?? []).map((s) => s.assigned_group_id).filter(Boolean))) as string[];
      const { data: openGroups } = groupIds.length
        ? await supabase.from("audit_groups").select("id,open_enrollment").in("id", groupIds)
        : { data: [] as { id: string; open_enrollment: boolean }[] };
      const openMap = new Map((openGroups ?? []).map((g) => [g.id, g.open_enrollment]));
      const map = new Map(responses?.map((r) => [r.survey_id, r]) ?? []);
      const now = Date.now();
      setRows((surveys ?? []).map((s) => {
        const r = map.get(s.id);
        const startsAt = (s as { starts_at: string | null }).starts_at;
        const endsAt = (s as { ends_at: string | null }).ends_at;
        return {
          id: s.id,
          title: s.title,
          description: s.description,
          approved_at: s.approved_at,
          progress: Number(r?.progress ?? 0),
          submitted: !!r?.submitted,
          open: !!openMap.get(s.assigned_group_id ?? ""),
          starts_at: startsAt,
          ends_at: endsAt,
          notYetOpen: !!startsAt && new Date(startsAt).getTime() > now,
          closed: !!endsAt && new Date(endsAt).getTime() < now && !r?.submitted,
        };
      }));
    })();
  }, [user]);

  const isListRoute = location.pathname === "/assigned" || location.pathname === "/assigned/";
  if (!isListRoute) return <Outlet />;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Assigned Audits</h1>
      <p className="text-muted-foreground mt-1 mb-6">Surveys assigned to your audit groups. Each member fills their own copy.</p>

      {rows.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-50" />
          No audits assigned yet.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {rows.map((s) => {
            const locked = (s.notYetOpen || s.closed) && !s.submitted;
            const inner = (
              <div className={`rounded-lg border bg-card p-5 h-full transition-colors ${locked ? "opacity-60" : "hover:border-accent"}`} style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="flex items-start justify-between mb-3">
                  <ClipboardList className="h-5 w-5 text-muted-foreground" />
                  {s.submitted ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3 w-3" /> Submitted</span>
                  ) : s.notYetOpen ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock className="h-3 w-3" /> Opens {new Date(s.starts_at!).toLocaleString()}</span>
                  ) : s.closed ? (
                    <span className="inline-flex items-center gap-1 text-xs text-destructive"><CalendarX className="h-3 w-3" /> Closed</span>
                  ) : s.open ? (
                    <span className="inline-flex items-center gap-1 text-xs text-accent font-medium"><UserPlus className="h-3 w-3" /> Open — claim it</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> {Math.round(s.progress)}% done</span>
                  )}
                </div>
                <div className="font-semibold tracking-tight">{s.title}</div>
                {s.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{s.description}</p>}
                {(s.starts_at || s.ends_at) && (
                  <div className="text-xs text-muted-foreground mt-2">
                    {s.starts_at && <span>From {new Date(s.starts_at).toLocaleDateString()} </span>}
                    {s.ends_at && <span>until {new Date(s.ends_at).toLocaleDateString()}</span>}
                  </div>
                )}
                <div className="mt-4 h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${s.submitted ? 100 : Math.round(s.progress)}%` }} />
                </div>
              </div>
            );
            if (locked) return <div key={s.id} className="cursor-not-allowed">{inner}</div>;
            return (
              <Link key={s.id} to="/assigned/$id" params={{ id: s.id }}>{inner}</Link>
            );
          })}
        </div>
      )}
    </div>
  );
}