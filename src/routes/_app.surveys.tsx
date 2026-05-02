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
import {
  Plus,
  FileText,
  Clock,
  CheckCircle2,
  Users,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "approved" | "archived";
  created_at: string;
  assigned_group_id: string | null;
  lead_auditor_id: string;
  lead_auditor_name?: string | null;
  lead_auditor_email?: string | null;
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
  const [loadingRows, setLoadingRows] = useState(true);

  const isListRoute = location.pathname === "/surveys";
  const isAdmin = hasRole("admin");
  const isLeadAuditor = hasRole("lead_auditor");

  useEffect(() => {
    if (!authLoading && !isLeadAuditor && !isAdmin) {
      navigate({ to: "/dashboard" });
    }
  }, [authLoading, isLeadAuditor, isAdmin, navigate]);

  const load = async () => {
    if (!user) return;

    setLoadingRows(true);

    const query = supabase
      .from("surveys")
      .select(
        "id,title,description,status,created_at,assigned_group_id,lead_auditor_id"
      )
      .order("created_at", { ascending: false });

    const { data, error } = isAdmin
      ? await query
      : await query.eq("lead_auditor_id", user.id);

    if (error) {
      setLoadingRows(false);
      toast.error(error.message);
      return;
    }

    const surveys = (data ?? []) as SurveyRow[];

    const leadIds = Array.from(
      new Set(surveys.map((s) => s.lead_auditor_id).filter(Boolean))
    );

    if (leadIds.length > 0) {
      const { data: leadProfiles } = await supabase
        .from("profiles")
        .select("id,email,full_name")
        .in("id", leadIds);

      const leadMap = new Map(
        (leadProfiles ?? []).map((p) => [
          p.id,
          {
            email: p.email,
            full_name: p.full_name,
          },
        ])
      );

      surveys.forEach((s) => {
        const lead = leadMap.get(s.lead_auditor_id);
        s.lead_auditor_name = lead?.full_name ?? null;
        s.lead_auditor_email = lead?.email ?? null;
      });
    }

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
    setLoadingRows(false);
  };

  useEffect(() => {
    if (user && (isLeadAuditor || isAdmin)) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isLeadAuditor, isAdmin]);

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
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {isAdmin ? "All Surveys" : "My Surveys"}
          </h1>

          <p className="text-muted-foreground mt-1">
            {isAdmin
              ? "View every compliance audit form and monitor progress across all lead auditors."
              : "Create compliance audits, upload PDFs, and monitor progress for your assigned forms."}
          </p>
        </div>

        <Button onClick={createSurvey} disabled={creating}>
          <Plus className="h-4 w-4 mr-2" />
          {creating ? "Creating…" : "New survey"}
        </Button>
      </div>

      {loadingRows ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          Loading surveys…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
          No surveys yet. Click <strong>New survey</strong> to start.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((s) => {
            const completion =
              typeof s.total_members === "number" && s.total_members > 0
                ? Math.round(
                    ((s.submitted_members ?? 0) / s.total_members) * 100
                  )
                : 0;

            return (
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

                  {isAdmin && (
                    <div className="mt-3 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                      <span className="font-medium">Lead auditor: </span>
                      {s.lead_auditor_name ||
                        s.lead_auditor_email ||
                        s.lead_auditor_id}
                    </div>
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
                              width: `${completion}%`,
                            }}
                          />
                        </div>

                        <div className="mt-1.5 text-xs text-muted-foreground">
                          Progress:{" "}
                          <span className="font-medium">{completion}%</span>
                        </div>
                      </div>
                    )}

                  <div className="text-xs text-muted-foreground mt-4">
                    {new Date(s.created_at).toLocaleDateString()}
                  </div>
                </Link>

                {s.status === "approved" && (
                  <div className="mt-4">
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        to="/surveys/$id/progress"
                        params={{
                          id: s.id,
                        }}
                      >
                        <BarChart3 className="h-4 w-4 mr-1" />
                        View progress
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
