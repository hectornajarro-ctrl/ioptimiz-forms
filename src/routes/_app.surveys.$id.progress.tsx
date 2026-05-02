import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Question {
  id: string;
  label?: string;
}

interface Section {
  id: string;
  title: string;
  questions: Question[];
}

interface SurveySchema {
  sections?: Section[];
}

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  progress: number;
  answered_questions: number;
  total_questions: number;
  submitted: boolean;
}

interface SurveyProgressRow {
  title: string;
  assigned_group_id: string | null;
  lead_auditor_id: string;
  schema: SurveySchema | null;
}

export const Route = createFileRoute("/_app/surveys/$id/progress")({
  component: SurveyProgress,
  head: () => ({
    meta: [{ title: "Survey progress — AuditFlow" }],
  }),
});

function getQuestionIds(schema: SurveySchema | null | undefined): string[] {
  const sections = schema?.sections ?? [];

  return sections.flatMap((section) =>
    (section.questions ?? [])
      .map((question) => question.id)
      .filter(Boolean)
  );
}

function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    const answer = value as {
      value?: unknown;
      comment?: unknown;
      evidence?: unknown;
    };

    if (answer.value === undefined || answer.value === null) return false;

    if (typeof answer.value === "string") {
      return answer.value.trim().length > 0;
    }

    return true;
  }

  return false;
}

function countAnsweredQuestions(
  answers: Record<string, unknown> | null | undefined,
  questionIds: string[]
): number {
  if (!answers || questionIds.length === 0) return 0;

  return questionIds.filter((questionId) => isAnswered(answers[questionId]))
    .length;
}

function SurveyProgress() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user, hasRole, loading: authLoading } = useAuth();

  const [survey, setSurvey] = useState<SurveyProgressRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const isAdmin = hasRole("admin");

  const stats = useMemo(() => {
    const total = members.length;
    const submitted = members.filter((m) => m.submitted).length;
    const inProgress = members.filter((m) => !m.submitted && m.progress > 0)
      .length;
    const notStarted = members.filter((m) => !m.submitted && m.progress === 0)
      .length;

    const submittedPct =
      total > 0 ? Math.round((submitted / total) * 100) : 0;

    const avgProgress =
      total > 0
        ? Math.round(
            members.reduce((sum, member) => sum + Number(member.progress), 0) /
              total
          )
        : 0;

    const totalQuestions = members[0]?.total_questions ?? 0;

    const answeredQuestions = members.reduce(
      (sum, member) => sum + member.answered_questions,
      0
    );

    const possibleQuestions = members.reduce(
      (sum, member) => sum + member.total_questions,
      0
    );

    const answeredPct =
      possibleQuestions > 0
        ? Math.round((answeredQuestions / possibleQuestions) * 100)
        : 0;

    return {
      total,
      submitted,
      inProgress,
      notStarted,
      submittedPct,
      avgProgress,
      totalQuestions,
      answeredQuestions,
      possibleQuestions,
      answeredPct,
      allDone: total > 0 && submitted === total,
    };
  }, [members]);

  const exportMember = async (memberId: string) => {
    setExportingId(memberId);

    try {
      const { data, error } = await supabase.functions.invoke(
        "export-survey-pdf",
        {
          body: {
            surveyId: id,
            userId: memberId,
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        toast.error("Export failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportingId(null);
    }
  };

  useEffect(() => {
    if (authLoading || !user) return;

    (async () => {
      setLoading(true);
      setForbidden(false);

      const { data: s, error: surveyError } = await supabase
        .from("surveys")
        .select("title,assigned_group_id,lead_auditor_id,schema")
        .eq("id", id)
        .single();

      if (surveyError || !s) {
        setLoading(false);
        toast.error(surveyError?.message ?? "Survey not found");
        return;
      }

      const surveyRow = s as SurveyProgressRow;
      const canView = isAdmin || surveyRow.lead_auditor_id === user.id;

      if (!canView) {
        setForbidden(true);
        setSurvey(surveyRow);
        setMembers([]);
        setLoading(false);
        return;
      }

      setSurvey(surveyRow);

      if (!surveyRow.assigned_group_id) {
        setMembers([]);
        setLoading(false);
        return;
      }

      const questionIds = getQuestionIds(surveyRow.schema);
      const totalQuestions = questionIds.length;

      const { data: groupMembers, error: membersError } = await supabase
        .from("audit_group_members")
        .select("user_id")
        .eq("group_id", surveyRow.assigned_group_id);

      if (membersError) {
        setLoading(false);
        toast.error(membersError.message);
        return;
      }

      const memberIds = groupMembers?.map((m) => m.user_id) ?? [];

      if (memberIds.length === 0) {
        setMembers([]);
        setLoading(false);
        return;
      }

      const [{ data: profiles, error: profilesError }, { data: responses }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id,email,full_name")
            .in("id", memberIds),
          supabase
            .from("survey_responses")
            .select("user_id,progress,submitted,answers")
            .eq("survey_id", id),
        ]);

      if (profilesError) {
        setLoading(false);
        toast.error(profilesError.message);
        return;
      }

      const respMap = new Map(
        (responses ?? []).map((r) => [
          r.user_id,
          {
            storedProgress: Number(r.progress ?? 0),
            submitted: Boolean(r.submitted),
            answers: (r.answers ?? {}) as Record<string, unknown>,
          },
        ])
      );

      setMembers(
        (profiles ?? []).map((p) => {
          const response = respMap.get(p.id);
          const answeredQuestions = countAnsweredQuestions(
            response?.answers,
            questionIds
          );

          const calculatedProgress =
            totalQuestions > 0
              ? Math.round((answeredQuestions / totalQuestions) * 100)
              : Number(response?.storedProgress ?? 0);

          return {
            id: p.id,
            email: p.email,
            full_name: p.full_name,
            progress: calculatedProgress,
            answered_questions: answeredQuestions,
            total_questions: totalQuestions,
            submitted: Boolean(response?.submitted),
          };
        })
      );

      setLoading(false);
    })();
  }, [id, user, authLoading, isAdmin]);

  if (authLoading || loading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  if (forbidden) {
    return (
      <div className="container mx-auto max-w-5xl py-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/surveys" })}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to surveys
        </Button>

        <div className="mt-6 rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-destructive font-semibold">
            <ShieldAlert className="h-5 w-5" />
            Access denied
          </div>

          <p className="text-sm text-muted-foreground mt-2">
            You can only view progress for surveys where you are the Lead
            Auditor. Admin users can view progress for all surveys.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl py-8">
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/surveys">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to surveys
          </Link>
        </Button>
      </div>

      <div
        className="rounded-lg border bg-card p-6 mb-6"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <h1 className="text-2xl font-semibold tracking-tight">
          {survey?.title ?? "Survey"} — progress
        </h1>

        <p className="text-muted-foreground mt-1">
          {isAdmin
            ? "Admin view of member auditor completion for this form."
            : "Live view of every member auditor's completion for your form."}
        </p>

        <p className="text-sm text-muted-foreground mt-2">
          Progress is calculated from answered questions:{" "}
          <span className="font-medium">
            answered questions / total questions
          </span>
          .
        </p>
      </div>

      {members.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-muted-foreground">
          No members in the assigned group.
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-4 gap-4 mb-6">
            <div
              className="rounded-lg border bg-card p-5"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide font-semibold mb-2">
                <Users className="h-4 w-4" />
                Members
              </div>

              <div className="text-3xl font-semibold">{stats.total}</div>

              <p className="text-xs text-muted-foreground mt-2">
                Total assigned auditors.
              </p>
            </div>

            <div
              className="rounded-lg border bg-card p-5"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide font-semibold mb-2">
                <CheckCircle2 className="h-4 w-4" />
                Submitted
              </div>

              <div className="text-3xl font-semibold">
                {stats.submitted} / {stats.total}
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                {stats.submittedPct}% submitted.
              </p>
            </div>

            <div
              className="rounded-lg border bg-card p-5"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide font-semibold mb-2">
                <Clock className="h-4 w-4" />
                Answered
              </div>

              <div className="text-3xl font-semibold">
                {stats.answeredPct}%
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                {stats.answeredQuestions} / {stats.possibleQuestions} total
                answers.
              </p>
            </div>

            <div
              className="rounded-lg border bg-card p-5"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide font-semibold mb-2">
                <Clock className="h-4 w-4" />
                Avg. answered
              </div>

              <div className="text-3xl font-semibold">
                {stats.avgProgress}%
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                Average answered questions per auditor.
              </p>
            </div>
          </div>

          <div
            className="rounded-lg border bg-card p-5 mb-6"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-center justify-between text-sm mb-2">
              <div className="font-medium">
                {stats.allDone ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    All members submitted
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    In progress
                  </span>
                )}
              </div>

              <div className="text-muted-foreground">
                {stats.answeredQuestions} / {stats.possibleQuestions} questions
                answered
              </div>
            </div>

            <div className="h-3 rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full transition-all ${
                  stats.answeredPct === 100 ? "bg-success" : "bg-accent"
                }`}
                style={{
                  width: `${stats.answeredPct}%`,
                }}
              />
            </div>
          </div>

          <div className="space-y-3">
            {members.map((m) => (
              <div
                key={m.id}
                className="rounded-lg border bg-card p-4 flex flex-wrap items-center gap-3"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="flex-1 min-w-64">
                  <div className="font-medium">{m.full_name || m.email}</div>

                  <div className="text-sm text-muted-foreground">{m.email}</div>
                </div>

                <div className="w-full sm:w-56">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>
                      {m.answered_questions} / {m.total_questions} answered
                    </span>
                    <span>{Math.round(m.progress)}%</span>
                  </div>

                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full ${
                        m.progress === 100 ? "bg-success" : "bg-accent"
                      }`}
                      style={{
                        width: `${Math.round(m.progress)}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="w-32 text-right">
                  {m.submitted ? (
                    <span className="inline-flex items-center gap-1 text-success text-sm">
                      <CheckCircle2 className="h-4 w-4" />
                      Submitted
                    </span>
                  ) : m.progress > 0 ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground text-sm">
                      <Clock className="h-4 w-4" />
                      In progress
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground text-sm">
                      <Clock className="h-4 w-4" />
                      Pending
                    </span>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportMember(m.id)}
                  disabled={exportingId === m.id}
                >
                  <Download className="h-4 w-4 mr-1" />
                  {exportingId === m.id ? "…" : "Export"}
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
