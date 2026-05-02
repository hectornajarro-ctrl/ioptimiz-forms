import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  Sparkles,
  Plus,
  Trash2,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Download,
  ClipboardList,
  ListChecks,
  Lightbulb,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type FieldType =
  | "text"
  | "textarea"
  | "yes_no"
  | "multiple_choice"
  | "rating"
  | "file";

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
  severity?: "Low" | "Medium" | "High" | "Critical" | string;
  likelihood?: "Low" | "Medium" | "High" | string;
  impact?: "Low" | "Medium" | "High" | string;
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

interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "approved" | "archived";
  mode: "compliance";
  pdf_path: string | null;
  schema: SurveySchema;
  assigned_group_id: string | null;
  lead_auditor_id: string;
  starts_at: string | null;
  ends_at: string | null;
}

export const Route = createFileRoute("/_app/surveys/$id")({
  component: SurveyEditor,
  head: () => ({
    meta: [{ title: "Survey editor — AuditFlow" }],
  }),
});

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";

  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";

  const pad = (n: number) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;

  const d = new Date(v);

  return isNaN(d.getTime()) ? null : d.toISOString();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const clean = value.trim();
    const key = clean.toLowerCase();

    if (clean && !seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }

  return result;
}

function getQuestionCount(sections: Section[]): number {
  return sections.reduce(
    (total, section) => total + section.questions.length,
    0
  );
}

function buildFallbackSummary(sections: Section[]): string {
  const questionCount = getQuestionCount(sections);

  if (questionCount === 0) return "";

  const sectionTitles = sections
    .map((section) => section.title)
    .filter(Boolean)
    .slice(0, 5);

  const topics =
    sectionTitles.length > 0
      ? ` Los principales temas identificados son: ${sectionTitles.join(", ")}.`
      : "";

  return `El PDF fue procesado como documento de auditoría de cumplimiento. Se identificaron ${questionCount} pregunta(s) auditable(s) organizadas en ${sections.length} sección(es).${topics}`;
}

function buildFallbackObjective(sections: Section[]): string {
  const questionCount = getQuestionCount(sections);

  if (questionCount === 0) return "";

  return "Verificar que la organización cumpla con los requisitos identificados en el PDF, revisando evidencias, responsables, registros y controles asociados a cada pregunta de auditoría.";
}

function deriveAuditorActions(sections: Section[]): string[] {
  const actions: string[] = [];

  sections.forEach((section) => {
    section.questions.forEach((question) => {
      actions.push(...asStringArray(question.recommended_actions));
    });
  });

  const uniqueActions = uniqueStrings(actions).slice(0, 8);

  if (uniqueActions.length > 0) {
    return uniqueActions;
  }

  if (getQuestionCount(sections) === 0) {
    return [];
  }

  return [
    "Revisar el documento normativo y confirmar el alcance de la auditoría.",
    "Solicitar políticas, procedimientos y registros relacionados con los requisitos identificados.",
    "Entrevistar a los responsables de los procesos auditados.",
    "Validar evidencias documentales, fechas, aprobaciones y responsables.",
    "Registrar los hallazgos cuando una respuesta sea No o exista evidencia insuficiente.",
    "Definir acciones correctivas para cada incumplimiento identificado.",
  ];
}

function SurveyEditor() {
  const { id } = Route.useParams();
  const { user, session, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [survey, setSurvey] = useState<SurveyRow | null>(null);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("surveys")
      .select(
        "id,title,description,status,mode,pdf_path,schema,assigned_group_id,lead_auditor_id,starts_at,ends_at"
      )
      .eq("id", id)
      .single();

    if (error) {
      toast.error(error.message);
      return;
    }

    const sch = (data.schema as any) ?? { sections: [] };
    const sections = (sch.sections ?? []) as Section[];

    const summary = String(sch.summary ?? "").trim();
    const auditorObjective = String(sch.auditor_objective ?? "").trim();
    const auditorActions = asStringArray(sch.auditor_actions);

    setSurvey({
      ...data,
      mode: "compliance",
      schema: {
        summary: summary || buildFallbackSummary(sections),
        auditor_objective: auditorObjective || buildFallbackObjective(sections),
        auditor_actions:
          auditorActions.length > 0
            ? auditorActions
            : deriveAuditorActions(sections),
        sections,
      },
      starts_at: (data as any).starts_at ?? null,
      ends_at: (data as any).ends_at ?? null,
    } as SurveyRow);

    const groupQuery = hasRole("admin")
      ? supabase.from("audit_groups").select("id,name").order("name")
      : supabase
          .from("audit_groups")
          .select("id,name")
          .eq("lead_auditor_id", data.lead_auditor_id)
          .order("name");

    const { data: g } = await groupQuery;

    setGroups(g ?? []);
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);

  if (location.pathname.endsWith("/progress")) {
    return <Outlet />;
  }

  if (!survey) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  const isOwner = user?.id === survey.lead_auditor_id || hasRole("admin");
  const isDraft = survey.status === "draft";

  const questionCount = getQuestionCount(survey.schema.sections);

  const hasExtractionSummary =
    !!survey.schema.summary ||
    !!survey.schema.auditor_objective ||
    questionCount > 0 ||
    (survey.schema.auditor_actions?.length ?? 0) > 0;

  const updateField = (patch: Partial<SurveyRow>) =>
    setSurvey({ ...survey, ...patch });

  const updateSchema = (sections: Section[]) =>
    setSurvey({
      ...survey,
      schema: {
        ...survey.schema,
        sections,
      },
    });

  const updateSchemaMeta = (patch: Partial<SurveySchema>) =>
    setSurvey({
      ...survey,
      schema: {
        ...survey.schema,
        ...patch,
      },
    });

  const persist = async () => {
    if (
      survey.starts_at &&
      survey.ends_at &&
      new Date(survey.ends_at) <= new Date(survey.starts_at)
    ) {
      return toast.error("End date must be after start date");
    }

    setSaving(true);

    const { error } = await supabase
      .from("surveys")
      .update({
        title: survey.title,
        description: survey.description,
        mode: "compliance",
        schema: survey.schema as any,
        assigned_group_id: survey.assigned_group_id,
        starts_at: survey.starts_at,
        ends_at: survey.ends_at,
      })
      .eq("id", survey.id);

    setSaving(false);

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return toast.error("Another survey of yours already uses this title");
      }

      return toast.error(error.message);
    }

    toast.success("Saved");
  };

  const onUpload = async (file: File) => {
    if (!user) return;

    if (file.type !== "application/pdf") {
      return toast.error("Please upload a PDF file");
    }

    if (file.size > 15 * 1024 * 1024) {
      return toast.error("File too large (max 15 MB)");
    }

    setUploading(true);

    const path = `${user.id}/${survey.id}/${Date.now()}-${file.name}`;

    const { error } = await supabase.storage
      .from("survey-pdfs")
      .upload(path, file, {
        upsert: false,
        contentType: "application/pdf",
      });

    if (error) {
      setUploading(false);
      return toast.error(error.message);
    }

    await supabase
      .from("surveys")
      .update({
        pdf_path: path,
        mode: "compliance",
      })
      .eq("id", survey.id);

    setUploading(false);

    toast.success("PDF uploaded");

    await load();
  };

  const runExtract = async () => {
    if (!survey.pdf_path) return toast.error("Upload a PDF first");
    if (!session) return;

    setExtracting(true);

    try {
      const { data, error } = await supabase.functions.invoke("extract-survey", {
        body: { surveyId: survey.id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { data: refreshedSurvey, error: refreshError } = await supabase
        .from("surveys")
        .select("schema")
        .eq("id", survey.id)
        .single();

      if (refreshError) throw refreshError;

      const refreshedSchema = (refreshedSurvey?.schema as any) ?? {
        sections: [],
      };

      const refreshedSections = (refreshedSchema.sections ?? []) as Section[];

      const realQuestionCount = getQuestionCount(refreshedSections);
      const realSectionCount = refreshedSections.length;

      toast.success(
        `Extracted ${realQuestionCount} question(s) in ${realSectionCount} section(s)`
      );

      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Extraction failed";
      toast.error(msg);
    } finally {
      setExtracting(false);
    }
  };

  const approve = async () => {
    if (!survey.assigned_group_id) {
      return toast.error("Assign a group first");
    }

    if (survey.schema.sections.length === 0) {
      return toast.error("Add at least one question");
    }

    await persist();

    const { error } = await supabase
      .from("surveys")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        mode: "compliance",
      })
      .eq("id", survey.id);

    if (error) return toast.error(error.message);

    toast.success("Survey approved & assigned");

    await load();
  };

  const reopen = async () => {
    const { error } = await supabase
      .from("surveys")
      .update({
        status: "draft",
        approved_at: null,
        mode: "compliance",
      })
      .eq("id", survey.id);

    if (error) return toast.error(error.message);

    toast.success("Survey reopened as draft");

    await load();
  };

  const deleteSurvey = async () => {
    const { error } = await supabase.from("surveys").delete().eq("id", survey.id);

    if (error) return toast.error(error.message);

    toast.success("Draft deleted");

    navigate({ to: "/surveys" });
  };

  const exportCombined = async () => {
    setExporting(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "export-survey-pdf",
        {
          body: { surveyId: survey.id },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) window.open(data.url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const addSection = () =>
    updateSchema([
      ...survey.schema.sections,
      {
        id: uid(),
        title: "New section",
        questions: [],
      },
    ]);

  const removeSection = (sid: string) =>
    updateSchema(survey.schema.sections.filter((s) => s.id !== sid));

  const editSection = (sid: string, patch: Partial<Section>) =>
    updateSchema(
      survey.schema.sections.map((s) => (s.id === sid ? { ...s, ...patch } : s))
    );

  const addQuestion = (sid: string) =>
    editSection(sid, {
      questions: [
        ...(survey.schema.sections.find((s) => s.id === sid)?.questions ?? []),
        {
          id: uid(),
          label: "New question",
          type: "yes_no",
          required: true,
          options: [],
          scale_max: 5,
          reference: {},
          risk: {},
          recommended_actions: [],
          expected_evidence: [],
        },
      ],
    });

  const editQuestion = (
    sid: string,
    qid: string,
    patch: Partial<Question>
  ) => {
    const sec = survey.schema.sections.find((s) => s.id === sid);

    if (!sec) return;

    editSection(sid, {
      questions: sec.questions.map((q) =>
        q.id === qid ? { ...q, ...patch } : q
      ),
    });
  };

  const removeQuestion = (sid: string, qid: string) => {
    const sec = survey.schema.sections.find((s) => s.id === sid);

    if (!sec) return;

    editSection(sid, {
      questions: sec.questions.filter((q) => q.id !== qid),
    });
  };

  return (
    <div className="container mx-auto max-w-5xl py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/surveys">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to surveys
          </Link>
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {survey.status === "approved" && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/surveys/$id/progress" params={{ id: survey.id }}>
                <BarChart3 className="h-4 w-4 mr-1" />
                View progress
              </Link>
            </Button>
          )}

          {survey.status === "approved" && isOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={exportCombined}
              disabled={exporting}
            >
              <Download className="h-4 w-4 mr-1" />
              {exporting ? "Generating…" : "Export report"}
            </Button>
          )}

          {isDraft && isOwner && (
            <>
              <Button variant="outline" onClick={persist} disabled={saving}>
                {saving ? "Saving…" : "Save draft"}
              </Button>

              <Button onClick={approve}>
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Approve & assign
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Delete</Button>
                </AlertDialogTrigger>

                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                    <AlertDialogDescription>
                      "{survey.title}" will be permanently deleted. This cannot
                      be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteSurvey}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}

          {!isDraft && isOwner && (
            <Button variant="outline" onClick={reopen}>
              Reopen as draft
            </Button>
          )}
        </div>
      </div>

      <div
        className="rounded-lg border bg-card p-6 mb-6"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={survey.title}
              onChange={(e) => updateField({ title: e.target.value })}
              disabled={!isDraft}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={survey.description ?? ""}
              onChange={(e) => updateField({ description: e.target.value })}
              disabled={!isDraft}
              maxLength={500}
            />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            This survey is configured as a compliance audit. AI extraction will
            generate Yes / No / N/A questions with normative references, risks,
            recommended actions and expected evidence.
          </div>

          <div className="space-y-1.5">
            <Label>Assign to group</Label>
            <Select
              value={survey.assigned_group_id ?? ""}
              onValueChange={(v) => updateField({ assigned_group_id: v || null })}
              disabled={!isDraft}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    groups.length
                      ? "Select a group"
                      : "You don't lead any groups yet"
                  }
                />
              </SelectTrigger>

              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Available from{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  optional
                </span>
              </Label>
              <Input
                type="datetime-local"
                value={toLocalInput(survey.starts_at)}
                onChange={(e) =>
                  updateField({ starts_at: fromLocalInput(e.target.value) })
                }
                disabled={!isDraft}
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Available until{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  optional
                </span>
              </Label>
              <Input
                type="datetime-local"
                value={toLocalInput(survey.ends_at)}
                onChange={(e) =>
                  updateField({ ends_at: fromLocalInput(e.target.value) })
                }
                disabled={!isDraft}
              />
            </div>

            <p className="text-xs text-muted-foreground sm:col-span-2 -mt-1">
              Members can only fill out this survey within this window. Leave
              empty for no time limit.
            </p>
          </div>
        </div>
      </div>

      {isDraft && (
        <div
          className="rounded-lg border bg-card p-6 mb-6"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <h2 className="font-semibold tracking-tight mb-1">Source PDF</h2>

          <p className="text-sm text-muted-foreground mb-4">
            Upload a PDF checklist, regulation, standard or policy. AI will
            generate audit questions, normative references, risks, recommended
            actions and expected evidence.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer">
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) =>
                  e.target.files?.[0] && onUpload(e.target.files[0])
                }
              />

              <span className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                <Upload className="h-4 w-4" />
                {uploading
                  ? "Uploading…"
                  : survey.pdf_path
                    ? "Replace PDF"
                    : "Upload PDF"}
              </span>
            </label>

            {survey.pdf_path && (
              <span className="text-xs text-muted-foreground truncate max-w-xs">
                {survey.pdf_path.split("/").pop()}
              </span>
            )}

            <Button
              onClick={runExtract}
              disabled={!survey.pdf_path || extracting}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {extracting ? "Extracting with AI…" : "Extract with AI"}
            </Button>
          </div>
        </div>
      )}

      {hasExtractionSummary && (
        <div className="grid md:grid-cols-3 gap-4 mb-6">
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

            <Label className="text-xs">Acciones sugeridas</Label>
            <Textarea
              value={(survey.schema.auditor_actions ?? []).join("\n")}
              onChange={(e) =>
                updateSchemaMeta({
                  auditor_actions: e.target.value
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
              disabled={!isDraft}
              placeholder="Una acción por línea"
              rows={11}
              maxLength={6000}
            />

            <p className="text-xs text-muted-foreground mt-2">
              Escribe una acción por línea. Estas acciones serán visibles para
              los auditores asignados.
            </p>
          </div>

          <div
            className="rounded-lg border bg-card p-5"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="mb-3 flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Preguntas encontradas
              </p>
            </div>

            <div className="text-4xl font-semibold tracking-tight">
              {questionCount}
            </div>

            <p className="text-sm text-muted-foreground mt-2">
              Preguntas generadas desde el PDF y organizadas en{" "}
              {survey.schema.sections.length} sección(es).
            </p>

            <p className="text-xs text-muted-foreground mt-4">
              Este valor se actualiza automáticamente según la cantidad de
              preguntas existentes en el Survey.
            </p>
          </div>

          <div
            className="rounded-lg border bg-card p-5"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Resumen del PDF y objetivo
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-xs">Resumen del PDF</Label>
                <Textarea
                  value={survey.schema.summary ?? ""}
                  onChange={(e) =>
                    updateSchemaMeta({
                      summary: e.target.value,
                    })
                  }
                  disabled={!isDraft}
                  placeholder="Resumen del contenido del PDF orientado a la auditoría"
                  rows={5}
                  maxLength={4000}
                />
              </div>

              <div>
                <Label className="text-xs">Objetivo del auditor</Label>
                <Textarea
                  value={survey.schema.auditor_objective ?? ""}
                  onChange={(e) =>
                    updateSchemaMeta({
                      auditor_objective: e.target.value,
                    })
                  }
                  disabled={!isDraft}
                  placeholder="Qué debe verificar el auditor durante la revisión"
                  rows={4}
                  maxLength={3000}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {survey.schema.sections.map((sec) => (
          <div
            key={sec.id}
            className="rounded-lg border bg-card p-5"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-start gap-3 mb-4">
              <Input
                value={sec.title}
                onChange={(e) =>
                  editSection(sec.id, { title: e.target.value })
                }
                disabled={!isDraft}
                className="font-semibold text-base"
                maxLength={200}
              />

              {isDraft && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSection(sec.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {sec.questions.map((q, idx) => (
                <div key={q.id} className="rounded-md border bg-background p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground mt-2 w-6 shrink-0">
                      {idx + 1}.
                    </span>

                    <div className="flex-1 grid gap-2">
                      <Input
                        value={q.label}
                        onChange={(e) =>
                          editQuestion(sec.id, q.id, {
                            label: e.target.value,
                          })
                        }
                        disabled={!isDraft}
                        placeholder="Question"
                        maxLength={500}
                      />

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                          Yes / No / N/A compliance check
                        </span>

                        <label className="text-xs flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={q.required}
                            disabled={!isDraft}
                            onChange={(e) =>
                              editQuestion(sec.id, q.id, {
                                required: e.target.checked,
                              })
                            }
                          />
                          Required
                        </label>

                        {isDraft && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeQuestion(sec.id, q.id)}
                            className="ml-auto text-muted-foreground hover:text-destructive h-8 w-8"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      <div className="mt-3 rounded-md border bg-muted/30 p-3 space-y-3">
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Normative reference
                          </p>

                          <div className="grid sm:grid-cols-3 gap-2 mt-2">
                            <Input
                              value={q.reference?.source_title ?? ""}
                              onChange={(e) =>
                                editQuestion(sec.id, q.id, {
                                  reference: {
                                    ...(q.reference ?? {}),
                                    source_title: e.target.value,
                                  },
                                })
                              }
                              disabled={!isDraft}
                              placeholder="Document / standard"
                              maxLength={200}
                            />

                            <Input
                              value={q.reference?.section ?? ""}
                              onChange={(e) =>
                                editQuestion(sec.id, q.id, {
                                  reference: {
                                    ...(q.reference ?? {}),
                                    section: e.target.value,
                                  },
                                })
                              }
                              disabled={!isDraft}
                              placeholder="Section / article / clause"
                              maxLength={120}
                            />

                            <Input
                              value={q.reference?.page ?? ""}
                              onChange={(e) =>
                                editQuestion(sec.id, q.id, {
                                  reference: {
                                    ...(q.reference ?? {}),
                                    page: e.target.value,
                                  },
                                })
                              }
                              disabled={!isDraft}
                              placeholder="Page"
                              maxLength={50}
                            />
                          </div>

                          <Textarea
                            className="mt-2"
                            value={q.reference?.requirement ?? ""}
                            onChange={(e) =>
                              editQuestion(sec.id, q.id, {
                                reference: {
                                  ...(q.reference ?? {}),
                                  requirement: e.target.value,
                                },
                              })
                            }
                            disabled={!isDraft}
                            placeholder="Requirement summary"
                            maxLength={1000}
                            rows={2}
                          />

                          <Textarea
                            className="mt-2"
                            value={q.reference?.source_text ?? ""}
                            onChange={(e) =>
                              editQuestion(sec.id, q.id, {
                                reference: {
                                  ...(q.reference ?? {}),
                                  source_text: e.target.value,
                                },
                              })
                            }
                            disabled={!isDraft}
                            placeholder="Short source text / excerpt"
                            maxLength={1500}
                            rows={2}
                          />
                        </div>

                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Risk if finding is detected
                          </p>

                          <div className="grid sm:grid-cols-2 gap-2 mt-2">
                            <Input
                              value={q.risk?.title ?? ""}
                              onChange={(e) =>
                                editQuestion(sec.id, q.id, {
                                  risk: {
                                    ...(q.risk ?? {}),
                                    title: e.target.value,
                                  },
                                })
                              }
                              disabled={!isDraft}
                              placeholder="Risk title"
                              maxLength={200}
                            />

                            <Input
                              value={q.risk?.category ?? ""}
                              onChange={(e) =>
                                editQuestion(sec.id, q.id, {
                                  risk: {
                                    ...(q.risk ?? {}),
                                    category: e.target.value,
                                  },
                                })
                              }
                              disabled={!isDraft}
                              placeholder="Category"
                              maxLength={100}
                            />
                          </div>

                          <div className="grid sm:grid-cols-3 gap-2 mt-2">
                            <Select
                              value={q.risk?.severity ?? ""}
                              onValueChange={(v) =>
                                editQuestion(sec.id, q.id, {
                                  risk: {
                                    ...(q.risk ?? {}),
                                    severity: v,
                                  },
                                })
                              }
                              disabled={!isDraft}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Severity" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Low">Low</SelectItem>
                                <SelectItem value="Medium">Medium</SelectItem>
                                <SelectItem value="High">High</SelectItem>
                                <SelectItem value="Critical">
                                  Critical
                                </SelectItem>
                              </SelectContent>
                            </Select>

                            <Select
                              value={q.risk?.likelihood ?? ""}
                              onValueChange={(v) =>
                                editQuestion(sec.id, q.id, {
                                  risk: {
                                    ...(q.risk ?? {}),
                                    likelihood: v,
                                  },
                                })
                              }
                              disabled={!isDraft}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Likelihood" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Low">Low</SelectItem>
                                <SelectItem value="Medium">Medium</SelectItem>
                                <SelectItem value="High">High</SelectItem>
                              </SelectContent>
                            </Select>

                            <Select
                              value={q.risk?.impact ?? ""}
                              onValueChange={(v) =>
                                editQuestion(sec.id, q.id, {
                                  risk: {
                                    ...(q.risk ?? {}),
                                    impact: v,
                                  },
                                })
                              }
                              disabled={!isDraft}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Impact" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Low">Low</SelectItem>
                                <SelectItem value="Medium">Medium</SelectItem>
                                <SelectItem value="High">High</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <Textarea
                            className="mt-2"
                            value={q.risk?.description ?? ""}
                            onChange={(e) =>
                              editQuestion(sec.id, q.id, {
                                risk: {
                                  ...(q.risk ?? {}),
                                  description: e.target.value,
                                },
                              })
                            }
                            disabled={!isDraft}
                            placeholder="Risk description"
                            maxLength={1500}
                            rows={2}
                          />
                        </div>

                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">
                              Recommended actions
                            </Label>
                            <Textarea
                              value={(q.recommended_actions ?? []).join("\n")}
                              onChange={(e) =>
                                editQuestion(sec.id, q.id, {
                                  recommended_actions: e.target.value
                                    .split("\n")
                                    .map((x) => x.trim())
                                    .filter(Boolean),
                                })
                              }
                              disabled={!isDraft}
                              placeholder="One action per line"
                              rows={4}
                            />
                          </div>

                          <div>
                            <Label className="text-xs">
                              Expected evidence
                            </Label>
                            <Textarea
                              value={(q.expected_evidence ?? []).join("\n")}
                              onChange={(e) =>
                                editQuestion(sec.id, q.id, {
                                  expected_evidence: e.target.value
                                    .split("\n")
                                    .map((x) => x.trim())
                                    .filter(Boolean),
                                })
                              }
                              disabled={!isDraft}
                              placeholder="One evidence item per line"
                              rows={4}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {isDraft && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addQuestion(sec.id)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add question
                </Button>
              )}
            </div>
          </div>
        ))}

        {isDraft && (
          <Button variant="outline" onClick={addSection} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Add section
          </Button>
        )}

        {survey.schema.sections.length === 0 && !isDraft && (
          <div className="text-center text-muted-foreground py-12">
            No questions in this survey.
          </div>
        )}
      </div>
    </div>
  );
}
