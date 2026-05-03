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

interface Question {
  id: string;
  label?: string;
}

interface Section {
  id: string;
  title?: string;
  questions?: Question[];
}

interface SurveySchema {
  sections?: Section[];
}

interface ComplianceAnswer {
  value?: unknown;
  comment?: unknown;
  evidence?: unknown;
}

interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "approved" | "archived";
  created_at: string;
  assigned_group_id: string | null;
  lead_auditor_id: string;
  schema: SurveySchema | null;
  lead_auditor_name?: string | null;
  lead_auditor_email?: string | null;
  total_members?: number;
  submitted_members?: number;
  all_completed?: boolean;
  total_questions?: number;
  answered_questions?: number;
  possible_questions?: number;
  progress_percent?: number;
}

interface SurveyResponseRow {
  survey_id: string;
  user_id: string;
  submitted: boolean | null;
  answers: Record<string, ComplianceAnswer> | null;
}

export const Route = createFileRoute("/_app/surveys")({
  component: Surveys,
  head: () => ({
    meta: [{ title: "Surveys — AuditFlow" }],
  }),
});

function getQuestionIds(schema: SurveySchema | null | undefined): string[] {
  const sections = schema?.sections ?? [];

  return sections.flatMap((section) =>
    (section.questions ?? [])
      .map((question) => String(question.id ?? "").trim())
      .filter(Boolean)
  );
}

function getAnswerValue(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const answer = value as ComplianceAnswer;

  if (answer.value === undefined || answer.value === null) return "";

  return String(answer.value).trim();
}

function getAnswerComment(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const answer = value as ComplianceAnswer;

  if (answer.comment === undefined || answer.comment === null) return "";

  return String(answer.comment).trim();
}

function isCompletedAnswer(value: unknown): boolean {
  return getAnswerValue(value).length > 0 && getAnswerComment(value).length > 0;
}

function countCompletedQuestions(
  answers: Record<string, ComplianceAnswer> | null | undefined,
  questionIds: string[]
): number {
  if (!answers || questionIds.length === 0) return 0;

  return questionIds.filter((questionId) =>
    isCompletedAnswer(answers[questionId])
  ).length;
}

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
        "id,title,description,status,created_at,assigned_group_id,lead_auditor_id,schema"
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
      new Set(surveys.map((survey) => survey.lead_auditor_id).filter(Boolean))
    );

    if (leadIds.length > 0) {
      const { data: leadProfiles, error: leadError } = await supabase
        .from("profiles")
        .select("id,email,full_name")
        .in("id", leadIds);

      if (leadError) {
        toast.error(leadError.message);
      } else {
        const leadMap = new Map(
          (leadProfiles ?? []).map((profile) => [
            profile.id,
            {
              email: profile.email,
              full_name: profile.full_name,
            },
          ])
        );

        surveys.forEach((survey) => {
          const lead = leadMap.get(survey.lead_auditor_id);

          survey.lead_auditor_name = lead?.full_name ?? null;
          survey.lead_auditor_email = lead?.email ?? null;
        });
      }
    }

    const approved = surveys.filter(
      (survey) => survey.status === "approved" && survey.assigned_group_id
    );

    if (approved.length > 0) {
      const auditIds = Array.from(
        new Set(approved.map((survey) => survey.assigned_group_id!))
      );

      const surveyIds = approved.map((survey) => survey.id);

      const [{ data: members, error: membersError }, { data: responses }] =
        await Promise.all([
          supabase
            .from("audits_members" as any)
            .select("group_id,user_id")
            .in("group_id", auditIds),
          supabase
            .from("survey_responses")
            .select("survey_id,user_id,submitted,answers")
            .in("survey_id", surveyIds),
        ]);

      if (membersError) {
        toast.error(membersError.message);
      }

      const membersByAudit = new Map<string, string[]>();

      ((members ?? []) as any[]).forEach((member) => {
        const current = membersByAudit.get(member.group_id) ?? [];

        current.push(member.user_id);
        membersByAudit.set(member.group_id, current);
      });

      const responsesBySurvey = new Map<string, SurveyResponseRow[]>();

      ((responses ?? []) as SurveyResponseRow[]).forEach((response) => {
        const current = responsesBySurvey.get(response.survey_id) ?? [];

        current.push(response);
        responsesBySurvey.set(response.survey_id, current);
      });

      surveys.forEach((survey) => {
        if (survey.status !== "approved" || !survey.assigned_group_id) return;

        const memberIds = membersByAudit.get(survey.assigned_group_id) ?? [];
        const memberIdSet = new Set(memberIds);
        const surveyResponses = responsesBySurvey.get(survey.id) ?? [];
        const questionIds = getQuestionIds(survey.schema);
        const totalQuestions = questionIds.length;

        const submittedMembers = surveyResponses.filter(
          (response) => memberIdSet.has(response.user_id) && response.submitted
        ).length;

        const answeredQuestions = surveyResponses
          .filter((response) => memberIdSet.has(response.user_id))
          .reduce(
            (total, response) =>
              total + countCompletedQuestions(response.answers, questionIds),
            0
          );

        const possibleQuestions = totalQuestions * memberIds.length;

        const progressPercent =
          possibleQuestions > 0
            ? Math.round((answeredQuestions / possibleQuestions) * 100)
            : 0;

        survey.total_members = memberIds.length;
        survey.submitted_members = submittedMembers;
        survey.all_completed =
          memberIds.length > 0 && submittedMembers >= memberIds.length;
        survey.total_questions = totalQuestions;
        survey.answered_questions = answeredQuestions;
        survey.possible_questions = possibleQuestions;
        survey.progress_percent = progressPercent;
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

    const taken = new Set(
      (existing ?? []).map((row) => row.title.toLowerCase())
    );

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

    if (error) {
      toast.error(error.message);
      return;
    }

    navigate({
      to: "/surveys/$id",
      params: {
        id: data.id,
      },
    });
  };

  const statusBadge = (status: SurveyRow["status"]) => {
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

    const value = map[status];
    const Icon = value.icon;

    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm ${value.bg} ${value.text}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {value.label}
      </span>
    );
  };

  if (!isListRoute) {
    return <Outlet />;
  }

  return (
    <div className="container mx-auto max-w-6xl py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isAdmin ? "All Surveys" : "My Surveys"}
          </h1>

          <p className="mt-1 text-muted-foreground">
            {isAdmin
              ? "View every compliance audit form and monitor progress across all lead auditors."
              : "Create compliance audits, upload PDFs, and monitor progress for your assigned forms."}
          </p>
        </div>

        <Button onClick={createSurvey} disabled={creating}>
          <Plus className="mr-2 h-4 w-4" />
          {creating ? "Creating…" : "New survey"}
        </Button>
      </div>

      {loadingRows ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          Loading surveys…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-16 text-center text-muted-foreground">
          <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          No surveys yet. Click{" "}
          <span className="font-semibold">New survey</span> to start.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((survey) => {
            const progress = survey.progress_percent ?? 0;
            const answered = survey.answered_questions ?? 0;
            const possible = survey.possible_questions ?? 0;

            return (
              <div
                key={survey.id}
                className="flex min-h-[260px] flex-col rounded-lg border bg-card p-5"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />

                  <div className="flex flex-wrap justify-end gap-2">
                    {survey.status === "approved" && survey.all_completed && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-sm text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Completed
                      </span>
                    )}

                    {statusBadge(survey.status)}
                  </div>
                </div>

                <Link
                  to="/surveys/$id"
                  params={{ id: survey.id }}
                  className="line-clamp-2 text-lg font-semibold tracking-tight hover:underline"
                >
                  {survey.title}
                </Link>

                {survey.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {survey.description}
                  </p>
                ) : (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    No description.
                  </p>
                )}

                <div className="mt-auto pt-4">
                  {isAdmin && (
                    <div className="mb-3 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                      <span className="font-medium">Lead auditor: </span>
                      {survey.lead_auditor_name ||
                        survey.lead_auditor_email ||
                        survey.lead_auditor_id}
                    </div>
                  )}

                  {survey.status === "approved" &&
                    typeof survey.total_members === "number" && (
                      <div className="mb-4 space-y-2">
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            Members completed
                          </span>
                          <span>
                            {survey.submitted_members ?? 0} /{" "}
                            {survey.total_members}
                          </span>
                        </div>

                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-full ${
                              progress === 100 ? "bg-success" : "bg-accent"
                            }`}
                            style={{
                              width: `${progress}%`,
                            }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            Questions completed: {answered} / {possible}
                          </span>
                          <span>Progress: {progress}%</span>
                        </div>
                      </div>
                    )}

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">
                      {new Date(survey.created_at).toLocaleDateString()}
                    </span>

                    {survey.status === "approved" && (
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          to="/surveys/$id/progress"
                          params={{ id: survey.id }}
                        >
                          <BarChart3 className="mr-2 h-4 w-4" />
                          View progress
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
