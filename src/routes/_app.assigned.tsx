import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { ClipboardList, CheckCircle2, Clock } from "lucide-react";

interface AssignedSurvey {
  id: string;
  title: string;
  description: string | null;
  approved_at: string | null;
  progress: number;
  submitted: boolean;
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
        .select("id,title,description,approved_at")
        .eq("status", "approved")
        .order("approved_at", { ascending: false });
      const { data: responses } = await supabase
        .from("survey_responses")
        .select("survey_id,progress,submitted")
        .eq("user_id", user.id);
      const map = new Map(responses?.map((r) => [r.survey_id, r]) ?? []);
      setRows((surveys ?? []).map((s) => {
        const r = map.get(s.id);
        return {
          ...s,
          progress: Number(r?.progress ?? 0),
          submitted: !!r?.submitted,
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
          {rows.map((s) => (
            <Link key={s.id} to="/assigned/$id" params={{ id: s.id }}>
              <div className="rounded-lg border bg-card p-5 h-full transition-colors hover:border-accent" style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="flex items-start justify-between mb-3">
                  <ClipboardList className="h-5 w-5 text-muted-foreground" />
                  {s.submitted ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3 w-3" /> Submitted</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> {Math.round(s.progress)}% done</span>
                  )}
                </div>
                <div className="font-semibold tracking-tight">{s.title}</div>
                {s.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{s.description}</p>}
                <div className="mt-4 h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${s.submitted ? 100 : Math.round(s.progress)}%` }} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}