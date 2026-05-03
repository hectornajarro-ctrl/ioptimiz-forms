import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ClipboardList,
  Download,
  Eye,
  FileImage,
  FileText,
  MessageSquare,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface AuditReference {
  source_title?: string;
  section?: string;
  page?: string;
  requirement?: string;
  source_text?: string;
}

interface AuditRisk {
  title?: string;
  description?: string;
  category?: string;
  severity?: string;
  likelihood?: string;
  impact?: string;
}

interface Question {
  id: string;
  label?: string;
  required?: boolean;
  reference?: AuditReference;
  risk?: AuditRisk;
  recommended_actions?: string[];
  expected_evidence?: string[];
}

interface Section {
  id: string;
  title: string;
  questions: Question[];
}

interface SurveySchema {
  sections?: Section[];
}

interface EvidenceFile {
  path: string;
  name: string;
}

interface ComplianceAnswer {
  value?: string;
  comment?: string;
  evidence?: EvidenceFile;
}

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  progress: number;
  answered_questions: number;
  total_questions: number;
  submitted: boolean;
  answers: Record<string, ComplianceAnswer>;
}

interface SurveyProgressRow {
  title: string;
  assigned_group_id: string | null;
  lead_auditor_id: string;
  pdf_path: string | null;
  schema: SurveySchema | null;
}

interface ActionPlanItem {
  id: string;
  auditorId: string;
  auditorName: string;
  auditorEmail: string;
  sectionTitle: string;
  questionLabel: string;
  answer: ComplianceAnswer;
  reference?: AuditReference;
  risk?: AuditRisk;
  recommendedActions: string[];
  expectedEvidence: string[];
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
    const answer = value as ComplianceAnswer;

    if (answer.value === undefined || answer.value === null) return false;

    if (typeof answer.value === "string") {
      return answer.value.trim().length > 0;
    }

    return true;
  }

  return false;
}

function countAnsweredQuestions(
  answers: Record<string, ComplianceAnswer> | null | undefined,
  questionIds: string[]
): number {
  if (!answers || questionIds.length === 0) return 0;

  return questionIds.filter((questionId) => isAnswered(answers[questionId]))
    .length;
}

function normalizeAnswers(value: unknown): Record<string, ComplianceAnswer> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return value as Record<string, ComplianceAnswer>;
}

function answerBadgeClass(value?: string) {
  if (value === "Yes") {
    return "border-success/30 bg-success/10 text-success";
  }

  if (value === "No") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }

  if (value === "N/A") {
    return "border-muted-foreground/30 bg-muted text-muted-foreground";
  }

  return "border-border bg-background text-muted-foreground";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function buildReferenceText(reference?: AuditReference): string {
  if (!reference) return "";

  return [
    reference.source_title,
    reference.section,
    reference.page ? `Página ${reference.page}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function fallbackActionsForFinding(question: Question): string[] {
  const actions = asStringArray(question.recommended_actions);

  if (actions.length > 0) return actions;

  return [
    "Analizar la causa raíz del incumplimiento identificado.",
    "Definir responsable y fecha objetivo para la corrección.",
    "Implementar acción correctiva documentada.",
    "Recolectar evidencia que demuestre la corrección del hallazgo.",
    "Validar la efectividad de la acción correctiva antes del cierre.",
  ];
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
  const [openingEvidence, setOpeningEvidence] = useState<string | null>(null);
  const [openingPdf, setOpeningPdf] = useState(false);

  const isAdmin = hasRole("admin");

  const questionIds = useMemo(
    () => getQuestionIds(survey?.schema),
    [survey?.schema]
  );

  const actionPlan = useMemo<ActionPlanItem[]>(() => {
    const items: ActionPlanItem[] = [];
    const sections = survey?.schema?.sections ?? [];

    members.forEach((member) => {
      sections.forEach((section) => {
        (section.questions ?? []).forEach((question) => {
          const answer = member.answers[question.id];

          if (answer?.value !== "No") return;

          items.push({
            id: `${member.id}-${question.id}`,
            auditorId: member.id,
            auditorName: member.full_name || member.email,
            auditorEmail: member.email,
            sectionTitle: section.title,
            questionLabel: question.label || "Untitled question",
            answer,
            reference: question.reference,
            risk: question.risk,
            recommendedActions: fallbackActionsForFinding(question),
            expectedEvidence: asStringArray(question.expected_evidence),
          });
        });
      });
    });

    return items;
  }, [members, survey?.schema?.sections]);

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

    const findings = members.reduce((sum, member) => {
      return (
        sum +
        questionIds.filter(
          (questionId) => member.answers[questionId]?.value === "No"
        ).length
      );
    }, 0);

    const evidenceCount = members.reduce((sum, member) => {
      return (
        sum +
        questionIds.filter(
          (questionId) => !!member.answers[questionId]?.evidence
        ).length
      );
    }, 0);

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
      findings,
      evidenceCount,
      actionPlanItems: actionPlan.length,
      allDone: total > 0 && submitted === total,
    };
  }, [members, questionIds, actionPlan.length]);

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

  const openSourcePdf = async () => {
    if (!survey?.pdf_path) return toast.error("No PDF uploaded");

    setOpeningPdf(true);

    try {
      const { data, error } = await supabase.storage
        .from("survey-pdfs")
        .createSignedUrl(survey.pdf_path, 60 * 10);

      if (error) throw error;

      if (!data?.signedUrl) {
        throw new Error("Could not create PDF link");
      }

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open PDF");
    } finally {
      setOpeningPdf(false);
    }
  };

  const openEvidenceFile = async (evidence: EvidenceFile) => {
    if (!evidence.path) return;

    setOpeningEvidence(evidence.path);

    try {
      const { data, error } = await supabase.storage
        .from("response-files")
        .createSignedUrl(evidence.path, 60 * 10);

      if (error) throw error;

      if (data?.signedUrl) {
        window.open(data.signedUrl, "_blank");
      } else {
        toast.error("Could not open evidence file");
      }
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Could not open evidence file. Check storage permissions."
      );
    } finally {
      setOpeningEvidence(null);
    }
  };

  useEffect(() => {
    if (authLoading || !user) return;

    (async () => {
      setLoading(true);
      setForbidden(false);

      const { data: s, error: surveyError } = await supabase
        .from("surveys")
        .select("title,assigned_group_id,lead_auditor_id,pdf_path,schema")
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

      const currentQuestionIds = getQuestionIds(surveyRow.schema);
      const totalQuestions = currentQuestionIds.length;

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
            answers: normalizeAnswers(r.answers),
          },
        ])
      );

      setMembers(
        (profiles ?? []).map((p) => {
          const response = respMap.get(p.id);
          const answers = response?.answers ?? {};
          const answeredQuestions = countAnsweredQuestions(
            answers,
            currentQuestionIds
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
            answers,
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
    <div className="container mx-auto max-w-6xl py-8">
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
            ? "Admin view of member auditor completion, collected evidence and action plan."
            : "Live view of each member auditor's progress, answers, findings, evidence and action plan."}
        </p>

        <p className="text-sm text-muted-foreground mt-2">
          Progress is calculated from answered questions:{" "}
          <span className="font-medium">
            answered questions / total questions
          </span>
          .
        </p>
      </div>

      {survey?.pdf_path && (
        <div
          className="rounded-lg border bg-card p-5 mb-6"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <FileText className="h-5 w-5 text-muted-foreground" />

            <div className="flex-1 min-w-64">
              <div className="font-semibold tracking-tight">Source PDF</div>
              <div className="text-sm text-muted-foreground truncate">
                {survey.pdf_path.split("/").pop()}
              </div>
            </div>

            <Button
              variant="outline"
              onClick={openSourcePdf}
              disabled={openingPdf}
            >
              <Eye className="h-4 w-4 mr-2" />
              {openingPdf ? "Opening…" : "View PDF"}
            </Button>
          </div>
        </div>
      )}

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
                <FileImage className="h-4 w-4" />
                Evidence / findings
              </div>

              <div className="text-3xl font-semibold">
                {stats.evidenceCount}
              </div>

              <p className="text-xs text-muted-foreground mt-2">
                Evidence files collected. Findings marked No: {stats.findings}.
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

          <div
            className="rounded-lg border bg-card p-5 mb-6"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-muted-foreground" />
                  <h2 className="text-lg font-semibold tracking-tight">
                    Plan de acción preliminar
                  </h2>
                </div>

                <p className="text-sm text-muted-foreground mt-1">
                  Se genera automáticamente con las respuestas marcadas como{" "}
                  <span className="font-medium">No</span>. Cada elemento
                  representa un hallazgo potencial que debe ser revisado,
                  corregido y cerrado con evidencia.
                </p>
              </div>

              <div className="rounded-full border bg-muted/30 px-3 py-1 text-sm text-muted-foreground">
                {stats.actionPlanItems} acción(es)
              </div>
            </div>

            {actionPlan.length === 0 ? (
              <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
                Todavía no hay hallazgos marcados como{" "}
                <span className="font-medium">No</span>. El plan de acción se
                irá creando conforme los auditores registren incumplimientos.
              </div>
            ) : (
              <div className="space-y-4">
                {actionPlan.map((item, index) => {
                  const referenceText = buildReferenceText(item.reference);
                  const hasComment = !!item.answer.comment?.trim();
                  const hasEvidence = !!item.answer.evidence?.path;

                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border bg-background p-4"
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-sm font-semibold text-destructive">
                          {index + 1}
                        </div>

                        <div className="flex-1 min-w-64">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
                              <AlertTriangle className="h-3 w-3" />
                              Hallazgo
                            </span>

                            {item.risk?.severity && (
                              <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
                                Severidad: {item.risk.severity}
                              </span>
                            )}

                            {item.risk?.category && (
                              <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
                                Categoría: {item.risk.category}
                              </span>
                            )}
                          </div>

                          <h3 className="mt-3 font-semibold tracking-tight">
                            {item.questionLabel}
                          </h3>

                          <div className="mt-1 text-sm text-muted-foreground">
                            <span className="font-medium">Sección: </span>
                            {item.sectionTitle}
                          </div>

                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium">Reportado por: </span>
                            {item.auditorName}
                          </div>

                          {referenceText && (
                            <div className="mt-2 rounded-md border bg-muted/30 p-3 text-sm">
                              <div className="font-medium">
                                Referencia normativa
                              </div>

                              <div className="text-muted-foreground">
                                {referenceText}
                              </div>

                              {item.reference?.requirement && (
                                <div className="mt-1 text-muted-foreground">
                                  {item.reference.requirement}
                                </div>
                              )}
                            </div>
                          )}

                          {item.risk && (
                            <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
                              <div className="font-medium">
                                Riesgo asociado
                              </div>

                              {item.risk.title && (
                                <div className="text-muted-foreground">
                                  {item.risk.title}
                                </div>
                              )}

                              {item.risk.description && (
                                <p className="mt-1 text-muted-foreground">
                                  {item.risk.description}
                                </p>
                              )}

                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                {item.risk.likelihood && (
                                  <span className="rounded-full border px-2 py-0.5">
                                    Probabilidad: {item.risk.likelihood}
                                  </span>
                                )}

                                {item.risk.impact && (
                                  <span className="rounded-full border px-2 py-0.5">
                                    Impacto: {item.risk.impact}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {hasComment && (
                            <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
                              <div className="mb-1 flex items-center gap-1 font-medium">
                                <MessageSquare className="h-4 w-4" />
                                Comentario / detalle del hallazgo
                              </div>

                              <p className="text-muted-foreground whitespace-pre-wrap">
                                {item.answer.comment}
                              </p>
                            </div>
                          )}

                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="rounded-md border bg-muted/30 p-3 text-sm">
                              <div className="font-medium">
                                Acciones recomendadas
                              </div>

                              <ul className="mt-2 list-disc pl-5 text-muted-foreground space-y-1">
                                {item.recommendedActions.map(
                                  (action, actionIndex) => (
                                    <li key={actionIndex}>{action}</li>
                                  )
                                )}
                              </ul>
                            </div>

                            <div className="rounded-md border bg-muted/30 p-3 text-sm">
                              <div className="font-medium">
                                Evidencia esperada para cierre
                              </div>

                              {item.expectedEvidence.length > 0 ? (
                                <ul className="mt-2 list-disc pl-5 text-muted-foreground space-y-1">
                                  {item.expectedEvidence.map(
                                    (evidence, evidenceIndex) => (
                                      <li key={evidenceIndex}>{evidence}</li>
                                    )
                                  )}
                                </ul>
                              ) : (
                                <p className="mt-2 text-muted-foreground">
                                  Documento, registro, captura, fotografía o
                                  validación que demuestre la corrección del
                                  hallazgo.
                                </p>
                              )}
                            </div>
                          </div>

                          {hasEvidence && item.answer.evidence && (
                            <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
                              <div className="mb-2 flex items-center gap-1 font-medium">
                                <FileImage className="h-4 w-4" />
                                Evidencia adjunta por el auditor
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                <span className="text-muted-foreground">
                                  {item.answer.evidence.name ||
                                    item.answer.evidence.path.split("/").pop()}
                                </span>

                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    openEvidenceFile(item.answer.evidence!)
                                  }
                                  disabled={
                                    openingEvidence ===
                                    item.answer.evidence.path
                                  }
                                >
                                  <Eye className="h-4 w-4 mr-1" />
                                  {openingEvidence === item.answer.evidence.path
                                    ? "Opening…"
                                    : "Open evidence"}
                                </Button>
                              </div>
                            </div>
                          )}

                          <div className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                            Estado sugerido:{" "}
                            <span className="font-medium">
                              Pendiente de análisis y asignación de responsable.
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {members.map((m) => (
              <div
                key={m.id}
                className="rounded-lg border bg-card p-4"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-64">
                    <div className="font-medium">{m.full_name || m.email}</div>

                    <div className="text-sm text-muted-foreground">
                      {m.email}
                    </div>
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

                <details className="mt-4 rounded-md border bg-muted/20">
                  <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
                    View collected answers, findings and evidence
                  </summary>

                  <div className="border-t p-4 space-y-5">
                    {(survey?.schema?.sections ?? []).map((section) => (
                      <div key={section.id} className="space-y-3">
                        <h3 className="font-semibold tracking-tight">
                          {section.title}
                        </h3>

                        {(section.questions ?? []).map((question, index) => {
                          const answer = m.answers[question.id];
                          const hasAnswer = isAnswered(answer);
                          const value = answer?.value;
                          const hasComment = !!answer?.comment?.trim();
                          const hasEvidence = !!answer?.evidence?.path;

                          return (
                            <div
                              key={question.id}
                              className="rounded-md border bg-background p-3"
                            >
                              <div className="flex flex-wrap items-start gap-3">
                                <div className="text-xs text-muted-foreground mt-1 w-6">
                                  {index + 1}.
                                </div>

                                <div className="flex-1 min-w-64">
                                  <div className="text-sm font-medium">
                                    {question.label}
                                    {question.required && (
                                      <span className="text-destructive ml-1">
                                        *
                                      </span>
                                    )}
                                  </div>

                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {hasAnswer ? (
                                      <span
                                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${answerBadgeClass(
                                          value
                                        )}`}
                                      >
                                        Answer: {value}
                                      </span>
                                    ) : (
                                      <span className="inline-flex rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
                                        Not answered
                                      </span>
                                    )}

                                    {value === "No" && (
                                      <span className="inline-flex rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
                                        Finding
                                      </span>
                                    )}

                                    {hasEvidence && (
                                      <span className="inline-flex rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
                                        Evidence attached
                                      </span>
                                    )}
                                  </div>

                                  {hasComment && (
                                    <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
                                      <div className="mb-1 flex items-center gap-1 font-medium">
                                        <MessageSquare className="h-4 w-4" />
                                        Comment / finding details
                                      </div>

                                      <p className="text-muted-foreground whitespace-pre-wrap">
                                        {answer.comment}
                                      </p>
                                    </div>
                                  )}

                                  {answer?.evidence && (
                                    <div className="mt-3 rounded-md border bg-muted/30 p-3 text-sm">
                                      <div className="mb-2 flex items-center gap-1 font-medium">
                                        <FileImage className="h-4 w-4" />
                                        Evidence
                                      </div>

                                      <div className="flex flex-wrap items-center gap-3">
                                        <span className="text-muted-foreground">
                                          {answer.evidence.name ||
                                            answer.evidence.path
                                              .split("/")
                                              .pop()}
                                        </span>

                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() =>
                                            openEvidenceFile(answer.evidence!)
                                          }
                                          disabled={
                                            openingEvidence ===
                                            answer.evidence.path
                                          }
                                        >
                                          <Eye className="h-4 w-4 mr-1" />
                                          {openingEvidence ===
                                          answer.evidence.path
                                            ? "Opening…"
                                            : "Open evidence"}
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
