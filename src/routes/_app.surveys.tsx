import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus, FileText, Clock, CheckCircle2, Users } from "lucide-react";

interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "approved" | "archived";
  created_at: string;
  assigned_group_id: string | null;
  total_members?: number;
  submitted_members?: number;
  all_completed?: boolean;
}

export const Route = createFileRoute("/_app/surveys")({
  component: Surveys,
  head: () => ({
    meta: [{ title: "Surveys — AuditFlow" }],
  }),
});

function Surveys() {
  const { user, hasRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [rows, setRows] = useState<SurveyRow[]>([]);
  const [creating, setCreating] = useState(false);

  const isListRoute = location.pathname === "/surveys";

  useEffect(() => {
    if (!authLoading && !hasRole("lead_auditor") && !hasRole("admin")) {
      navigate({ to: "/dashboard" });
    }
  }, [authLoading, hasRole, navigate]);

  const load = async () => {
    if (!user) return;

    const { data } = await supabase
      .from("surveys")
      .select("id,title,description,status,created_at,assigned_group_id")
      .eq("lead_auditor_id", user.id)
      .order("created_at", { ascending: false });

    const surveys = (data ?? []) as SurveyRow[];

    const approved = surveys.filter(
      (s) => s.status === "approved" && s.assigned_group_id
    );

    if (approved.length > 0) {
      const groupIds = Array.from(
        new Set(approved.map((s) => s.assigned_group_id!))
      );
      const surveyIds = approved.map((s) => s.id);

      const [{ data: members }, { data: responses }] = await Promise.all([
        supabase
          .from("audit_group_members")
          .select("group_id,user_id")
          .in("group_id", groupIds),
        supabase
          .from("survey_responses")
          .select("survey_id,submitted")
          .in("survey_id", surveyIds),
      ]);

      const memberCount = new Map<string, number>();

      (members ?? []).forEach((m) => {
        memberCount.set(m.group_id, (memberCount.get(m.group_id) ?? 0) + 1);
      });

      const submittedCount = new Map<string, number>();

      (responses ?? []).forEach((r) => {
        if (r.submitted) {
          submittedCount.set(
            r.survey_id,
            (submittedCount.get(r.survey_id) ?? 0) + 1
          );
        }
      });

      surveys.forEach((s) => {
        if (s.status === "approved" && s.assigned_group_id) {
          const total = memberCount.get(s.assigned_group_id) ?? 0;
          const done = submittedCount.get(s.id) ?? 0;

          s.total_members = total;
          s.submitted_members = done;
          s.all_completed = total > 0 && done >= total;
        }
      });
    }

    setRows(surveys);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  const createSurvey = async () => {
    if (!user) return;

    setCreating(true);

    const { data: existing } = await supabase
      .from("surveys")
      .select("title")
      .eq("lead_auditor_id", user.id)
      .ilike("title", "untitled survey%");

    const taken = new Set((existing ?? []).map((r) => r.title.toLowerCase()));

    let title = "Untitled survey";
    let n = 2;

    while (taken.has(title.toLowerCase())) {
      title = `Untitled survey ${n++}`;
    }

    const { data, error } = await supabase
      .from("surveys")
      .insert({
        title,
        lead_auditor_id: user.id,
        mode: "compliance",
      })
      .select("id")
      .single();

    setCreating(false);

    if (error) return toast.error(error.message);

    navigate({
      to: "/surveys/$id",
      params: { id: data.id },
    });
  };

  const statusBadge = (s: SurveyRow["status"]) => {
    const map: Record<
      string,
      {
        bg: string;
        text: string;
        label: string;
        icon: ComponentType<{ className?: string }>;
      }
    > = {
      draft: {
        bg: "bg-warning/15",
        text: "text-warning-foreground",
        label: "Draft",
        icon: Clock,
      },
      approved: {
        bg: "bg-success/15",
        text: "text-success",
        label: "Approved",
        icon: CheckCircle2,
      },
      archived: {
        bg: "bg-muted",
        text: "text-muted-foreground",
        label: "Archived",
        icon: FileText,
      },
    };

    const v = map[s];
    const Icon = v.icon;

    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${v.bg} ${v.text}`}
      >
        <Icon className="h-3 w-3" />
        {v.label}
      </span>
    );
  };

  if (!isListRoute) {
    return <Outlet />;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            My Surveys
          </h1>
          <p className="text-muted-foreground mt-1">
            Create compliance audits, upload PDFs, and assign approved forms to
            groups.
          </p>
        </div>

        <Button onClick={createSurvey} disabled={creating}>
          <Plus className="h-4 w-4 mr-2" />
          {creating ? "Creating…" : "New survey"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
          No surveys yet. Click <strong>New survey</strong> to start.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((s) => (
            <div
              key={s.id}
              className="relative rounded-lg border border-border bg-card p-5 h-full transition-colors hover:border-accent"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <Link to="/surveys/$id" params={{ id: s.id }} className="block">
                <div className="flex items-start justify-between mb-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />

                  <div className="flex items-center gap-2">
                    {s.status === "approved" && s.all_completed && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs bg-success/15 text-success">
                        <CheckCircle2 className="h-3 w-3" />
                        Completed
                      </span>
                    )}

                    {statusBadge(s.status)}
                  </div>
                </div>

                <div className="font-semibold tracking-tight">{s.title}</div>

                {s.description && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                    {s.description}
                  </p>
                )}

                {s.status === "approved" &&
                  typeof s.total_members === "number" && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          Members completed
                        </span>
                        <span>
                          {s.submitted_members ?? 0} / {s.total_members}
                        </span>
                      </div>

                      <div className="h-2 rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            s.all_completed ? "bg-success" : "bg-accent"
                          }`}
                          style={{
                            width: `${
                              s.total_members > 0
                                ? Math.round(
                                    ((s.submitted_members ?? 0) /
                                      s.total_members) *
                                      100
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                <div className="text-xs text-muted-foreground mt-4">
                  {new Date(s.created_at).toLocaleDateString()}
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
