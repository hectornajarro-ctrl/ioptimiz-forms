import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, CheckCircle2, Clock } from "lucide-react";

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  progress: number;
  submitted: boolean;
}

export const Route = createFileRoute("/_app/surveys/$id/progress")({
  component: SurveyProgress,
  head: () => ({ meta: [{ title: "Survey progress — AuditFlow" }] }),
});

function SurveyProgress() {
  const { id } = Route.useParams();
  const [survey, setSurvey] = useState<{ title: string; assigned_group_id: string | null } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase
        .from("surveys")
        .select("title,assigned_group_id")
        .eq("id", id)
        .single();
      if (!s) return;
      setSurvey(s);

      if (!s.assigned_group_id) { setLoading(false); return; }

      const { data: gm } = await supabase
        .from("audit_group_members")
        .select("user_id")
        .eq("group_id", s.assigned_group_id);
      const memberIds = gm?.map((m) => m.user_id) ?? [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id,email,full_name")
        .in("id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);

      const { data: responses } = await supabase
        .from("survey_responses")
        .select("user_id,progress,submitted")
        .eq("survey_id", id);

      const respMap = new Map(responses?.map((r) => [r.user_id, r]) ?? []);
      setMembers(
        (profiles ?? []).map((p) => {
          const r = respMap.get(p.id);
          return {
            id: p.id,
            email: p.email,
            full_name: p.full_name,
            progress: Number(r?.progress ?? 0),
            submitted: !!r?.submitted,
          };
        })
      );
      setLoading(false);
    })();
  }, [id]);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to="/surveys/$id" params={{ id }} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to survey
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">{survey?.title ?? "Survey"} — progress</h1>
      <p className="text-muted-foreground mt-1 mb-6">Live view of every member auditor's completion.</p>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : members.length === 0 ? (
        <div className="text-center text-muted-foreground py-12 border border-dashed rounded-lg">No members in the assigned group.</div>
      ) : (
        <>
          {(() => {
            const submitted = members.filter((m) => m.submitted).length;
            const allDone = submitted === members.length;
            const pct = Math.round((submitted / members.length) * 100);
            return (
              <div className={`rounded-lg border p-5 mb-5 ${allDone ? "bg-success/10 border-success/30" : "bg-card"}`} style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold tracking-tight flex items-center gap-2">
                    {allDone ? (
                      <><CheckCircle2 className="h-5 w-5 text-success" /> All members completed</>
                    ) : (
                      <><Clock className="h-5 w-5 text-muted-foreground" /> In progress</>
                    )}
                  </div>
                  <div className="text-sm font-medium">{submitted} / {members.length} submitted</div>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full transition-all ${allDone ? "bg-success" : "bg-accent"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })()}
          <div className="space-y-3">
          {members.map((m) => (
            <div key={m.id} className="rounded-lg border bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-medium">{m.full_name || m.email}</div>
                  <div className="text-xs text-muted-foreground">{m.email}</div>
                </div>
                <div className="text-sm font-medium flex items-center gap-2">
                  {m.submitted ? (
                    <span className="text-success flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Submitted</span>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-4 w-4" /> {Math.round(m.progress)}%</span>
                  )}
                </div>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${m.submitted ? 100 : Math.round(m.progress)}%` }}
                />
              </div>
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}