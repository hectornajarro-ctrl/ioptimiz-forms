import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  CheckCircle2,
  Camera,
  Download,
  ClipboardList,
  Lightbulb,
  Eye,
  FileText,
  Save,
  ListFilter,
} from "lucide-react";

type FieldType =
  | "text"
  | "textarea"
  | "yes_no"
  | "multiple_choice"
  | "rating"
  | "file";

type QuestionViewFilter = "all" | "completed" | "pending";

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
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  scale_max: number;
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
  summary?: string;
  auditor_objective?: string;
  auditor_actions?: string[];
  sections: Section[];
}

interface ComplianceAnswer {
  value?: string;
  comment?: string;
  evidence?: {
    path: string;
    name: string;
  };
}

export const Route = createFileRoute("/_app/assigned/$id")({
  component: FillSurvey,
  head: () => ({
    meta: [{ title: "Fill audit — AuditFlow" }],
  }),
});

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function hasReference(q: Question) {
  return Boolean(
    q.reference?.source_title ||
      q.reference?.section ||
      q.reference?.page ||
      q.reference?.requirement ||
      q.reference?.source_text ||
      (q.expected_evidence?.length ?? 0) > 0
  );
}

function hasRisk(q: Question) {
  return Boolean(
    q.risk?.title ||
      q.risk?.description ||
      q.risk?.category ||
      q.risk?.severity ||
      q.risk?.likelihood ||
      q.risk?.impact ||
      (q.recommended_actions?.length ?? 0) > 0
  );
}

function hasObjectContent(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).length > 0
  );
}

function normalizeAnswers(value: unknown): Record<string, ComplianceAnswer> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return value as Record<string, ComplianceAnswer>;
}

function getAnswerValue(
  answers: Record<string, ComplianceAnswer>,
  questionId: string
): string {
  const answer = answers[questionId];
  const value = answer?.value;

  if (value === undefined || value === null) return "";

  return String(value).trim();
}

function getAnswerComment(
  answers: Record<string, ComplianceAnswer>,
  questionId: string
): string {
  const answer = answers[questionId];
  const comment = answer?.comment;

  if (comment === undefined || comment === null) return "";

  return String(comment).trim();
}

function isQuestionCompleted(
  answers: Record<string, ComplianceAnswer>,
  questionId: string
): boolean {
  const value = getAnswerValue(answers, questionId);
  const comment = getAnswerComment(answers, questionId);

  return value.length > 0 && comment.length > 0;
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const clean = String(value ?? "").trim();

    if (!clean) return;

    const key = clean.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  });

  return result;
}

function FillSurvey() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [survey, setSurvey] = useState<{
    title: string;
    description: string | null;
    schema: SurveySchema;
    mode: "compliance";
    pdf_path: string | null;
    starts_at: string | null;
    ends_at: string | null;
  } | null>(null);

  const [responseId, setResponseId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, ComplianceAnswer>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [openingPdf, setOpeningPdf] = useState(false);
  const [questionFilter, setQuestionFilter] =
    useState<QuestionViewFilter>("all");
  const [completedValueFilter, setCompletedValueFilter] = useState("all");

  const allQuestions = useMemo(
    () => survey?.schema.sections.flatMap((s) => s.questions) ?? [],
    [survey]
  );

  const completedCount = useMemo(() => {
    return allQuestions.filter((q) => isQuestionCompleted(answers, q.id))
      .length;
  }, [allQuestions, answers]);

  const pendingCount = useMemo(() => {
    return allQuestions.length - completedCount;
  }, [allQuestions.length, completedCount]);

  const progress = useMemo(() => {
    if (allQuestions.length === 0) return 0;

    return Math.round((completedCount / allQuestions.length) * 100);
  }, [allQuestions.length, completedCount]);

  const canSubmit = allQuestions.length > 0 && completedCount === allQuestions.length;

  const completedFilterValues = useMemo(() => {
    const baseValues = ["Yes", "No", "N/A"];

    const optionValues = allQuestions.flatMap((question) =>
      asStringArray(question.options)
    );

    const answerValues = allQuestions
      .filter((question) => isQuestionCompleted(answers, question.id))
      .map((question) => getAnswerValue(answers, question.id))
      .filter(Boolean);

    return uniqueValues([...baseValues, ...optionValues, ...answerValues]);
  }, [allQuestions, answers]);

  const filteredSections = useMemo(() => {
    if (!survey) return [];

    return survey.schema.sections
      .map((section) => {
        const filteredQuestions = section.questions.filter((question) => {
          const answerValue = getAnswerValue(answers, question.id);
          const completed = isQuestionCompleted(answers, question.id);

          if (questionFilter === "pending") {
            return !completed;
          }

          if (questionFilter === "completed") {
            if (!completed) return false;

            if (completedValueFilter === "all") return true;

            return answerValue === completedValueFilter;
          }

          return true;
        });

        return {
          ...section,
          questions: filteredQuestions,
        };
      })
      .filter((section) => section.questions.length > 0);
  }, [survey, answers, questionFilter, completedValueFilter]);

  const visibleQuestionCount = useMemo(() => {
    return filteredSections.reduce(
      (total, section) => total + section.questions.length,
      0
    );
  }, [filteredSections]);

  useEffect(() => {
    if (!user) return;

    (async () => {
      const { data: s } = await supabase
        .from("surveys")
        .select(
          "title,description,schema,mode,pdf_path,assigned_group_id,starts_at,ends_at"
        )
        .eq("id", id)
        .single();

      if (!s) return;

      const sch = (s.schema as any) ?? { sections: [] };

      setSurvey({
        title: s.title,
        description: s.description,
        schema: {
          summary: String(sch.summary ?? ""),
          auditor_objective: String(sch.auditor_objective ?? ""),
          auditor_actions: asStringArray(sch.auditor_actions),
          sections: sch.sections ?? [],
        },
        mode: "compliance",
        pdf_path: (s as any).pdf_path ?? null,
        starts_at: (s as any).starts_at ?? null,
        ends_at: (s as any).ends_at ?? null,
      });

      const now = Date.now();
      const startsAt = (s as any).starts_at as string | null;
      const endsAt = (s as any).ends_at as string | null;

      const notYetOpen = !!startsAt && new Date(startsAt).getTime() > now;
      const closed = !!endsAt && new Date(endsAt).getTime() < now;

      const { data: existing } = await supabase
        .from("survey_responses")
        .select("id,answers,draft_answers,submitted")
        .eq("survey_id", id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        const publicAnswers = normalizeAnswers((existing as any).answers);
        const draftAnswers = normalizeAnswers((existing as any).draft_answers);

        setResponseId(existing.id);

        if (existing.submitted) {
          setAnswers(publicAnswers);
        } else if (hasObjectContent(draftAnswers)) {
          setAnswers(draftAnswers);
        } else {
          setAnswers(publicAnswers);
        }

        setSubmitted(existing.submitted);

        if (closed && !existing.submitted) {
          toast.error(
            "This audit has closed. You can no longer submit answers."
          );
        }

        return;
      }

      if (notYetOpen) {
        toast.error(
          `This audit opens on ${new Date(startsAt!).toLocaleString()}`
        );
        navigate({ to: "/assigned" });
        return;
      }

      if (closed) {
        toast.error("This audit has closed.");
        navigate({ to: "/assigned" });
        return;
      }

      const groupId = (s as any).assigned_group_id as string | null;

      if (groupId) {
        const { data: grp } = await supabase
          .from("audit_groups")
          .select("open_enrollment")
          .eq("id", groupId)
          .maybeSingle();

        const { data: existingMembers } = await supabase
          .from("audit_group_members")
          .select("user_id")
          .eq("group_id", groupId);

        const isMember = !!existingMembers?.some((m) => m.user_id === user.id);

        const isUnclaimed = (existingMembers?.length ?? 0) === 0;

        if (!isMember && grp?.open_enrollment && isUnclaimed) {
          const { error: claimErr } = await supabase
            .from("audit_group_members")
            .insert({
              group_id: groupId,
              user_id: user.id,
            });

          if (claimErr) {
            toast.error("Someone else just claimed this audit");
            navigate({ to: "/assigned" });
            return;
          }

          toast.success("You claimed this audit");
        } else if (!isMember && grp?.open_enrollment && !isUnclaimed) {
          toast.error("This audit has already been claimed by another member");
          navigate({ to: "/assigned" });
          return;
        }
      }

      const { data: created, error } = await supabase
        .from("survey_responses")
        .insert({
          survey_id: id,
          user_id: user.id,
          answers: {},
          draft_answers: {},
          progress: 0,
          draft_progress: 0,
        } as any)
        .select("id")
        .single();

      if (error) {
        toast.error(error.message);
        return;
      }

      setResponseId(created.id);
    })();
  }, [id, user, navigate]);

  useEffect(() => {
    if (questionFilter !== "completed") {
      setCompletedValueFilter("all");
    }
  }, [questionFilter]);

  useEffect(() => {
    if (
      completedValueFilter !== "all" &&
      !completedFilterValues.includes(completedValueFilter)
    ) {
      setCompletedValueFilter("all");
    }
  }, [completedValueFilter, completedFilterValues]);

  const getCompVal = (qid: string) => answers[qid] ?? {};

  const setCompField = (qid: string, patch: Partial<ComplianceAnswer>) => {
    const cur = getCompVal(qid);

    setAnswers({
      ...answers,
      [qid]: {
        ...cur,
        ...patch,
      },
    });
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

  const onUploadFile = async (qid: string, file: File) => {
    if (!user) return;

    if (file.size > 10 * 1024 * 1024) {
      return toast.error("File too large (max 10 MB)");
    }

    const path = `${user.id}/${id}/${qid}-${Date.now()}-${file.name}`;

    const { error } = await supabase.storage
      .from("response-files")
      .upload(path, file, {
        upsert: false,
      });

    if (error) return toast.error(error.message);

    setCompField(qid, {
      evidence: {
        path,
        name: file.name,
      },
    });

    toast.success("File attached");
  };

  const persist = async (
    opts: {
      draft?: boolean;
      submit?: boolean;
    } = {}
  ) => {
    if (!responseId) return;

    if (
      survey?.ends_at &&
      new Date(survey.ends_at).getTime() < Date.now() &&
      !submitted
    ) {
      return toast.error("This audit has closed and can no longer be modified.");
    }

    setSaving(true);

    if (opts.submit) {
      if (allQuestions.length === 0) {
        setSaving(false);
        return toast.error("This audit has no questions to submit.");
      }

      const missing = allQuestions.filter(
        (q) => !isQuestionCompleted(answers, q.id)
      );

      if (missing.length) {
        setSaving(false);
        return toast.error(
          `No puedes enviar todavía. Faltan ${missing.length} pregunta(s) por completar con respuesta y comentario.`
        );
      }

      const payload = {
        answers,
        draft_answers: answers,
        progress: 100,
        draft_progress: 100,
        submitted: true,
        submitted_at: new Date().toISOString(),
        progress_saved_at: new Date().toISOString(),
        draft_saved_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("survey_responses")
        .update(payload as any)
        .eq("id", responseId);

      setSaving(false);

      if (error) return toast.error(error.message);

      setSubmitted(true);
      setQuestionFilter("all");
      setCompletedValueFilter("all");
      toast.success("Submitted ✓");
      return;
    }

    if (opts.draft) {
      const payload = {
        draft_answers: answers,
        draft_progress: progress,
        draft_saved_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("survey_responses")
        .update(payload as any)
        .eq("id", responseId);

      setSaving(false);

      if (error) return toast.error(error.message);

      toast.success("Draft saved. Only you can continue from this draft.");
      return;
    }

    const payload = {
      answers,
      draft_answers: answers,
      progress,
      draft_progress: progress,
      progress_saved_at: new Date().toISOString(),
      draft_saved_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("survey_responses")
      .update(payload as any)
      .eq("id", responseId);

    setSaving(false);

    if (error) return toast.error(error.message);

    toast.success("Progress saved. Your leader can now see this progress.");
  };

  const exportReport = async () => {
    setExporting(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "export-survey-pdf",
        {
          body: {
            surveyId: id,
            userId: user?.id,
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
      setExporting(false);
    }
  };

  const renderActionButtons = (position: "top" | "bottom") => {
    if (submitted) return null;

    return (
      <div
        className={`flex flex-wrap items-center justify-end gap-3 ${
          position === "top" ? "mb-6" : "mt-6"
        }`}
      >
        <Button
          variant="outline"
          onClick={() => persist({ draft: true })}
          disabled={saving}
        >
          <FileText className="h-4 w-4 mr-2" />
          {saving ? "Saving…" : "Save draft"}
        </Button>

        <Button variant="outline" onClick={() => persist()} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Saving…" : "Save progress"}
        </Button>

        <Button
          onClick={() => persist({ submit: true })}
          disabled={saving || !canSubmit}
          title={
            canSubmit
              ? "Submit audit"
              : "Completa todas las preguntas con respuesta y comentario para enviar"
          }
        >
          <CheckCircle2 className="h-4 w-4 mr-2" />
          {saving ? "Saving…" : "Submit audit"}
        </Button>

        {!canSubmit && allQuestions.length > 0 && (
          <div className="w-full text-right text-xs text-muted-foreground">
            Para enviar, completa todas las preguntas con respuesta y comentario.
            Faltan {pendingCount}.
          </div>
        )}
      </div>
    );
  };

  const renderQuestionFilters = () => (
    <div
      className="rounded-lg border bg-card p-4 mb-6"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium mr-auto">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          Filtro de preguntas
        </div>

        <Button
          type="button"
          variant={questionFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuestionFilter("all")}
        >
          Ver todo
          <span className="ml-2 rounded-full bg-background/20 px-2 text-xs">
            {allQuestions.length}
          </span>
        </Button>

        <Button
          type="button"
          variant={questionFilter === "pending" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuestionFilter("pending")}
        >
          Ver pendiente
          <span className="ml-2 rounded-full bg-background/20 px-2 text-xs">
            {pendingCount}
          </span>
        </Button>

        <Button
          type="button"
          variant={questionFilter === "completed" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuestionFilter("completed")}
        >
          Ver completado
          <span className="ml-2 rounded-full bg-background/20 px-2 text-xs">
            {completedCount}
          </span>
        </Button>

        {questionFilter === "completed" && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Respuesta</Label>

            <select
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={completedValueFilter}
              onChange={(e) => setCompletedValueFilter(e.target.value)}
            >
              <option value="all">Todo</option>

              {completedFilterValues.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        Mostrando {visibleQuestionCount} de {allQuestions.length} pregunta(s).
        Para considerarse completada, cada pregunta debe tener respuesta y
        comentario. Progreso actual:{" "}
        <span className="font-medium">{completedCount}</span> completada(s),{" "}
        <span className="font-medium">{pendingCount}</span> pendiente(s).
        {questionFilter === "completed" && completedValueFilter !== "all" && (
          <>
            {" "}
            Filtro aplicado:{" "}
            <span className="font-medium">{completedValueFilter}</span>.
          </>
        )}
      </div>
    </div>
  );

  if (!survey) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  const hasAuditContext =
    !!survey.schema.summary ||
    !!survey.schema.auditor_objective ||
    (survey.schema.auditor_actions?.length ?? 0) > 0;

  return (
    <div className="container mx-auto max-w-5xl py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/assigned">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to assigned audits
          </Link>
        </Button>

        <div className="ml-auto text-sm text-muted-foreground">
          {submitted ? "Submitted" : `${progress}% complete`}
        </div>
      </div>

      <div
        className="rounded-lg border bg-card p-6 mb-6"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-64">
            <h1 className="text-2xl font-semibold tracking-tight">
              {survey.title}
            </h1>

            {survey.description && (
              <p className="text-muted-foreground mt-2">{survey.description}</p>
            )}
          </div>

          {submitted && (
            <Button
              variant="outline"
              size="sm"
              onClick={exportReport}
              disabled={exporting}
            >
              <Download className="h-4 w-4 mr-1" />
              {exporting ? "Generating…" : "Export report (PDF)"}
            </Button>
          )}
        </div>

        {!submitted && (
          <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            <span className="font-medium">Save draft</span> keeps the answers
            only as your working draft.{" "}
            <span className="font-medium">Save progress</span> publishes your
            current progress so your Leader/Admin can see it.
          </div>
        )}

        {submitted && (
          <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            You've submitted this audit. Answers below are read-only.
          </div>
        )}
      </div>

      {renderActionButtons("top")}

      {survey.pdf_path && (
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

      {hasAuditContext && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div
            className="rounded-lg border bg-card p-5"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Resumen y objetivo de la auditoría
              </p>
            </div>

            {survey.schema.summary && (
              <p className="text-sm text-muted-foreground mb-3">
                {survey.schema.summary}
              </p>
            )}

            {survey.schema.auditor_objective && (
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                <span className="font-medium">Objetivo del auditor: </span>
                {survey.schema.auditor_objective}
              </div>
            )}
          </div>

          <div
            className="rounded-lg border bg-card p-5"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="mb-3 flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Acciones sugeridas para el auditor
              </p>
            </div>

            {(survey.schema.auditor_actions?.length ?? 0) > 0 ? (
              <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                {survey.schema.auditor_actions!.map((action, idx) => (
                  <li key={idx}>{action}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No se registraron acciones sugeridas.
              </p>
            )}
          </div>
        </div>
      )}

      {renderQuestionFilters()}

      {visibleQuestionCount === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center text-muted-foreground">
          No hay preguntas para mostrar con el filtro seleccionado.
        </div>
      ) : (
        <div className="space-y-6">
          {filteredSections.map((sec) => (
            <div
              key={sec.id}
              className="rounded-lg border bg-card p-6"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <h2 className="text-lg font-semibold tracking-tight mb-4">
                {sec.title}
              </h2>

              <div className="space-y-5">
                {sec.questions.map((q, i) => (
                  <div
                    key={q.id}
                    className="rounded-md border bg-background p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-muted-foreground mt-1 w-6 shrink-0">
                        {i + 1}.
                      </span>

                      <div className="flex-1 space-y-3">
                        <div>
                          <Label className="text-base">
                            {q.label}
                            {q.required && (
                              <span className="text-destructive ml-1">*</span>
                            )}
                          </Label>
                        </div>

                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {[
                              {
                                v: "Yes",
                                cls: "data-[on=true]:bg-success data-[on=true]:text-white data-[on=true]:border-success",
                              },
                              {
                                v: "No",
                                cls: "data-[on=true]:bg-destructive data-[on=true]:text-destructive-foreground data-[on=true]:border-destructive",
                              },
                              {
                                v: "N/A",
                                cls: "data-[on=true]:bg-muted data-[on=true]:text-foreground data-[on=true]:border-muted-foreground/40",
                              },
                            ].map(({ v, cls }) => {
                              const on = getCompVal(q.id).value === v;

                              return (
                                <button
                                  key={v}
                                  type="button"
                                  data-on={on}
                                  disabled={submitted}
                                  onClick={() =>
                                    setCompField(q.id, { value: v })
                                  }
                                  className={`px-4 py-2 rounded-md border text-sm transition-colors bg-background hover:bg-accent hover:text-accent-foreground ${cls}`}
                                >
                                  {v}
                                </button>
                              );
                            })}
                          </div>

                          {hasReference(q) && (
                            <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
                              <div className="font-medium">
                                Normative reference
                              </div>

                              {(q.reference?.source_title ||
                                q.reference?.section ||
                                q.reference?.page) && (
                                <div className="text-muted-foreground">
                                  {[
                                    q.reference?.source_title,
                                    q.reference?.section,
                                    q.reference?.page &&
                                      `Page ${q.reference.page}`,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </div>
                              )}

                              {q.reference?.requirement && (
                                <div>
                                  <span className="font-medium">
                                    Requirement:{" "}
                                  </span>
                                  {q.reference.requirement}
                                </div>
                              )}

                              {q.reference?.source_text && (
                                <div className="text-xs text-muted-foreground">
                                  {q.reference.source_text}
                                </div>
                              )}

                              {(q.expected_evidence?.length ?? 0) > 0 && (
                                <div>
                                  <div className="font-medium">
                                    Expected evidence:
                                  </div>
                                  <ul className="list-disc pl-5 text-muted-foreground">
                                    {q.expected_evidence!.map((item, idx) => (
                                      <li key={idx}>{item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}

                          {getCompVal(q.id).value === "No" && hasRisk(q) && (
                            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-2">
                              <div className="font-semibold text-destructive">
                                Finding risk:{" "}
                                {q.risk?.title ||
                                  "Potential non-compliance risk"}
                              </div>

                              <div className="flex flex-wrap gap-2 text-xs">
                                {q.risk?.category && (
                                  <span className="rounded-full border px-2 py-0.5">
                                    {q.risk.category}
                                  </span>
                                )}

                                {q.risk?.severity && (
                                  <span className="rounded-full border px-2 py-0.5">
                                    Severity: {q.risk.severity}
                                  </span>
                                )}

                                {q.risk?.likelihood && (
                                  <span className="rounded-full border px-2 py-0.5">
                                    Likelihood: {q.risk.likelihood}
                                  </span>
                                )}

                                {q.risk?.impact && (
                                  <span className="rounded-full border px-2 py-0.5">
                                    Impact: {q.risk.impact}
                                  </span>
                                )}
                              </div>

                              {q.risk?.description && (
                                <p className="text-muted-foreground">
                                  {q.risk.description}
                                </p>
                              )}

                              {(q.recommended_actions?.length ?? 0) > 0 && (
                                <div>
                                  <div className="font-medium">
                                    Recommended actions:
                                  </div>
                                  <ul className="list-disc pl-5 text-muted-foreground">
                                    {q.recommended_actions!.map(
                                      (item, idx) => (
                                        <li key={idx}>{item}</li>
                                      )
                                    )}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}

                          <Textarea
                            placeholder="Comment / finding details"
                            value={getCompVal(q.id).comment ?? ""}
                            onChange={(e) =>
                              setCompField(q.id, {
                                comment: e.target.value,
                              })
                            }
                            disabled={submitted}
                            maxLength={2000}
                            rows={2}
                          />

                          {!isQuestionCompleted(answers, q.id) && (
                            <p className="text-xs text-muted-foreground">
                              Para completar esta pregunta, selecciona una
                              respuesta y agrega un comentario.
                            </p>
                          )}

                          <div className="flex items-center gap-3">
                            <label className="cursor-pointer">
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={submitted}
                                onChange={(e) =>
                                  e.target.files?.[0] &&
                                  onUploadFile(q.id, e.target.files[0])
                                }
                              />

                              <span className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                                <Camera className="h-4 w-4" />
                                {getCompVal(q.id).evidence?.name
                                  ? "Replace photo evidence"
                                  : "Add photo evidence"}
                              </span>
                            </label>

                            {getCompVal(q.id).evidence?.name && (
                              <span className="text-xs text-muted-foreground truncate max-w-xs">
                                {getCompVal(q.id).evidence!.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {renderActionButtons("bottom")}
    </div>
  );
}
