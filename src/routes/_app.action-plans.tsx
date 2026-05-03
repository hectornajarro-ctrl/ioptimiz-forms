import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Eye,
  FileImage,
  FileText,
  Filter,
  FolderKanban,
  ListTodo,
  Save,
  Search,
  Upload,
  User,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type ActionPlanStatus = "pending" | "in_progress" | "closed" | "cancelled";
type StatusFilter = "all" | ActionPlanStatus;

interface ActionPlansSearch {
  surveyId?: string;
}

interface AuditReference {
  source_title?: string;
  section?: string;
  page?: string;
  requirement?: string;
  source_text?: string;
  [key: string]: unknown;
}

interface AuditRisk {
  title?: string;
  description?: string;
  category?: string;
  severity?: string;
  likelihood?: string;
  impact?: string;
  [key: string]: unknown;
}

interface SurveyLite {
  id: string;
  title: string;
  lead_auditor_id: string;
  assigned_group_id: string | null;
}

interface AuditLite {
  id: string;
  name: string;
}

interface AuditorLite {
  id: string;
  full_name: string | null;
  email: string;
}

interface ActionPlanItem {
  id: string;
  survey_id: string;
  survey_response_id: string | null;
  auditor_id: string | null;
  question_id: string;
  section_title: string;
  question_label: string;
  reference: AuditReference;
  risk: AuditRisk;
  finding_comment: string | null;
  recommended_actions: string[];
  expected_evidence: string[];
  corrective_action: string | null;
  responsible_user_id: string | null;
  responsible_name: string | null;
  due_date: string | null;
  status: ActionPlanStatus;
  closure_comment: string | null;
  closure_evidence_path: string | null;
  closure_evidence_name: string | null;
  created_at: string;
  updated_at: string;
  survey_title: string;
  audit_id: string | null;
  audit_name: string;
  auditor_name: string;
  auditor_email: string;
}

interface SurveyGroup {
  surveyId: string;
  surveyTitle: string;
  totalItems: number;
  closedItems: number;
  pendingItems: number;
  inProgressItems: number;
  cancelledItems: number;
  progressPercent: number;
  items: ActionPlanItem[];
}

interface AuditGroup {
  auditId: string | null;
  auditName: string;
  totalItems: number;
  closedItems: number;
  pendingItems: number;
  inProgressItems: number;
  cancelledItems: number;
  progressPercent: number;
  surveys: SurveyGroup[];
}

export const Route = createFileRoute("/_app/action-plans")({
  validateSearch: (search: Record<string, unknown>): ActionPlansSearch => {
    return {
      surveyId:
        typeof search.surveyId === "string" && search.surveyId.trim()
          ? search.surveyId
          : undefined,
    };
  },
  component: ActionPlansPage,
  head: () => ({
    meta: [{ title: "Action Plans — AuditFlow" }],
  }),
});

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeJsonObject<T extends Record<string, unknown>>(
  value: unknown
): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as T;
  }

  return value as T;
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

function statusLabel(status: ActionPlanStatus) {
  const labels: Record<ActionPlanStatus, string> = {
    pending: "Pendiente",
    in_progress: "En progreso",
    closed: "Cerrado",
    cancelled: "Cancelado",
  };

  return labels[status];
}

function statusClass(status: ActionPlanStatus) {
  if (status === "closed") {
    return "border-success/30 bg-success/10 text-success";
  }

  if (status === "in_progress") {
    return "border-accent/30 bg-accent/10 text-accent-foreground";
  }

  if (status === "cancelled") {
    return "border-muted-foreground/30 bg-muted text-muted-foreground";
  }

  return "border-warning/30 bg-warning/10 text-warning-foreground";
}

function statusIcon(status: ActionPlanStatus) {
  if (status === "closed") return CheckCircle2;
  if (status === "in_progress") return Clock;
  if (status === "cancelled") return XCircle;

  return AlertTriangle;
}

function progressClass(progress: number) {
  return progress === 100 ? "bg-success" : "bg-accent";
}

function ActionPlansPage() {
  const { user, hasRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const searchParams = Route.useSearch();

  const [items, setItems] = useState<ActionPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingEvidenceId, setUploadingEvidenceId] =
    useState<string | null>(null);
  const [openingEvidence, setOpeningEvidence] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const isAdmin = hasRole("admin");
  const canView = isAdmin || hasRole("lead_auditor");

  const selectedSurveyId = searchParams.surveyId ?? "";
  const isSurveyDetailWindow = selectedSurveyId.length > 0;

  const openSurveyActionPlans = (surveyId: string) => {
    navigate({
      to: "/action-plans",
      search: {
        surveyId,
      },
    });
  };

  const loadData = async () => {
    if (!user) return;

    setLoading(true);

    try {
      const { data: surveysData, error: surveysError } = isAdmin
        ? await supabase
            .from("surveys")
            .select("id,title,lead_auditor_id,assigned_group_id")
            .order("created_at", { ascending: false })
        : await supabase
            .from("surveys")
            .select("id,title,lead_auditor_id,assigned_group_id")
            .eq("lead_auditor_id", user.id)
            .order("created_at", { ascending: false });

      if (surveysError) throw surveysError;

      const surveys = (surveysData ?? []) as SurveyLite[];

      if (surveys.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }

      const surveyMap = new Map<string, SurveyLite>();
      surveys.forEach((survey) => surveyMap.set(survey.id, survey));

      const surveyIds = surveys.map((survey) => survey.id);

      const auditIds = Array.from(
        new Set(
          surveys
            .map((survey) => survey.assigned_group_id)
            .filter((value): value is string => !!value)
        )
      );

      let auditMap = new Map<string, AuditLite>();

      if (auditIds.length > 0) {
        const { data: auditsData, error: auditsError } = await supabase
          .from("audits" as any)
          .select("id,name")
          .in("id", auditIds);

        if (auditsError) throw auditsError;

        auditMap = new Map(
          ((auditsData ?? []) as unknown as AuditLite[]).map((audit) => [
            audit.id,
            audit,
          ])
        );
      }

      const { data: actionPlanData, error: actionPlanError } = await supabase
        .from("action_plan_items")
        .select("*")
        .in("survey_id", surveyIds)
        .order("created_at", { ascending: true });

      if (actionPlanError) throw actionPlanError;

      const rawItems = (actionPlanData ?? []) as any[];

      const auditorIds = Array.from(
        new Set(
          rawItems
            .map((item) => item.auditor_id)
            .filter((value): value is string => !!value)
        )
      );

      let auditorMap = new Map<string, AuditorLite>();

      if (auditorIds.length > 0) {
        const { data: auditorsData, error: auditorsError } = await supabase
          .from("profiles")
          .select("id,full_name,email")
          .in("id", auditorIds);

        if (auditorsError) throw auditorsError;

        auditorMap = new Map(
          ((auditorsData ?? []) as AuditorLite[]).map((auditor) => [
            auditor.id,
            auditor,
          ])
        );
      }

      const mappedItems: ActionPlanItem[] = rawItems.map((item) => {
        const survey = surveyMap.get(item.survey_id);
        const auditId = survey?.assigned_group_id ?? null;
        const audit = auditId ? auditMap.get(auditId) : null;
        const auditor = item.auditor_id
          ? auditorMap.get(item.auditor_id)
          : undefined;

        return {
          id: item.id,
          survey_id: item.survey_id,
          survey_response_id: item.survey_response_id ?? null,
          auditor_id: item.auditor_id ?? null,
          question_id: item.question_id,
          section_title: item.section_title ?? "",
          question_label: item.question_label ?? "Untitled question",
          reference: normalizeJsonObject<AuditReference>(item.reference),
          risk: normalizeJsonObject<AuditRisk>(item.risk),
          finding_comment: item.finding_comment ?? null,
          recommended_actions: asStringArray(item.recommended_actions),
          expected_evidence: asStringArray(item.expected_evidence),
          corrective_action: item.corrective_action ?? null,
          responsible_user_id: item.responsible_user_id ?? null,
          responsible_name: item.responsible_name ?? null,
          due_date: item.due_date ?? null,
          status: (item.status ?? "pending") as ActionPlanStatus,
          closure_comment: item.closure_comment ?? null,
          closure_evidence_path: item.closure_evidence_path ?? null,
          closure_evidence_name: item.closure_evidence_name ?? null,
          created_at: item.created_at,
          updated_at: item.updated_at,
          survey_title: survey?.title ?? "Survey",
          audit_id: auditId,
          audit_name: audit?.name ?? "Sin Audit asignado",
          auditor_name:
            auditor?.full_name || auditor?.email || "Auditor no identificado",
          auditor_email: auditor?.email ?? "",
        };
      });

      setItems(mappedItems);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los action plans"
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !user || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, canView, isAdmin]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedSurveyId && item.survey_id !== selectedSurveyId) {
        return false;
      }

      const matchesStatus =
        statusFilter === "all" ? true : item.status === statusFilter;

      if (!matchesStatus) return false;

      const term = searchText.trim().toLowerCase();

      if (!term) return true;

      const haystack = [
        item.audit_name,
        item.survey_title,
        item.section_title,
        item.question_label,
        item.auditor_name,
        item.auditor_email,
        item.responsible_name ?? "",
        item.corrective_action ?? "",
        item.finding_comment ?? "",
        item.risk?.title ?? "",
        item.risk?.description ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [items, searchText, statusFilter, selectedSurveyId]);

  const groupedByAudit = useMemo<AuditGroup[]>(() => {
    const auditsMap = new Map<
      string,
      {
        auditId: string | null;
        auditName: string;
        items: ActionPlanItem[];
        surveys: Map<
          string,
          {
            surveyId: string;
            surveyTitle: string;
            items: ActionPlanItem[];
          }
        >;
      }
    >();

    filteredItems.forEach((item) => {
      const auditKey = item.audit_id ?? "__no_audit__";

      if (!auditsMap.has(auditKey)) {
        auditsMap.set(auditKey, {
          auditId: item.audit_id,
          auditName: item.audit_name,
          items: [],
          surveys: new Map(),
        });
      }

      const auditGroup = auditsMap.get(auditKey)!;

      auditGroup.items.push(item);

      if (!auditGroup.surveys.has(item.survey_id)) {
        auditGroup.surveys.set(item.survey_id, {
          surveyId: item.survey_id,
          surveyTitle: item.survey_title,
          items: [],
        });
      }

      auditGroup.surveys.get(item.survey_id)!.items.push(item);
    });

    return Array.from(auditsMap.values()).map((auditGroup) => {
      const auditClosed = auditGroup.items.filter(
        (item) => item.status === "closed"
      ).length;

      const auditPending = auditGroup.items.filter(
        (item) => item.status === "pending"
      ).length;

      const auditInProgress = auditGroup.items.filter(
        (item) => item.status === "in_progress"
      ).length;

      const auditCancelled = auditGroup.items.filter(
        (item) => item.status === "cancelled"
      ).length;

      const auditProgress =
        auditGroup.items.length > 0
          ? Math.round((auditClosed / auditGroup.items.length) * 100)
          : 0;

      const surveys = Array.from(auditGroup.surveys.values()).map(
        (surveyGroup) => {
          const closedItems = surveyGroup.items.filter(
            (item) => item.status === "closed"
          ).length;

          const pendingItems = surveyGroup.items.filter(
            (item) => item.status === "pending"
          ).length;

          const inProgressItems = surveyGroup.items.filter(
            (item) => item.status === "in_progress"
          ).length;

          const cancelledItems = surveyGroup.items.filter(
            (item) => item.status === "cancelled"
          ).length;

          const progressPercent =
            surveyGroup.items.length > 0
              ? Math.round((closedItems / surveyGroup.items.length) * 100)
              : 0;

          return {
            surveyId: surveyGroup.surveyId,
            surveyTitle: surveyGroup.surveyTitle,
            totalItems: surveyGroup.items.length,
            closedItems,
            pendingItems,
            inProgressItems,
            cancelledItems,
            progressPercent,
            items: surveyGroup.items,
          };
        }
      );

      return {
        auditId: auditGroup.auditId,
        auditName: auditGroup.auditName,
        totalItems: auditGroup.items.length,
        closedItems: auditClosed,
        pendingItems: auditPending,
        inProgressItems: auditInProgress,
        cancelledItems: auditCancelled,
        progressPercent: auditProgress,
        surveys,
      };
    });
  }, [filteredItems]);

  const stats = useMemo(() => {
    const source = selectedSurveyId ? filteredItems : items;

    const total = source.length;
    const pending = source.filter((item) => item.status === "pending").length;
    const inProgress = source.filter(
      (item) => item.status === "in_progress"
    ).length;
    const closed = source.filter((item) => item.status === "closed").length;
    const cancelled = source.filter(
      (item) => item.status === "cancelled"
    ).length;

    return {
      total,
      pending,
      inProgress,
      closed,
      cancelled,
    };
  }, [items, filteredItems, selectedSurveyId]);

  const selectedSurveyTitle = useMemo(() => {
    if (!selectedSurveyId) return "";

    return items.find((item) => item.survey_id === selectedSurveyId)
      ?.survey_title;
  }, [items, selectedSurveyId]);

  const updateItem = (itemId: string, patch: Partial<ActionPlanItem>) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    );
  };

  const saveItem = async (item: ActionPlanItem) => {
    setSavingId(item.id);

    try {
      const { error } = await supabase
        .from("action_plan_items")
        .update({
          corrective_action: item.corrective_action?.trim() || null,
          responsible_name: item.responsible_name?.trim() || null,
          responsible_user_id: item.responsible_user_id || null,
          due_date: item.due_date || null,
          status: item.status,
          closure_comment: item.closure_comment?.trim() || null,
        })
        .eq("id", item.id);

      if (error) throw error;

      toast.success("Action plan guardado");
      await loadData();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el action plan"
      );
    } finally {
      setSavingId(null);
    }
  };

  const uploadClosureEvidence = async (item: ActionPlanItem, file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      return toast.error("File too large (max 10 MB)");
    }

    setUploadingEvidenceId(item.id);

    try {
      const path = `${item.survey_id}/${item.id}/${Date.now()}-${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("action-plan-files")
        .upload(path, file, {
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from("action_plan_items")
        .update({
          closure_evidence_path: path,
          closure_evidence_name: file.name,
        })
        .eq("id", item.id);

      if (updateError) throw updateError;

      toast.success("Evidencia de cierre cargada");
      await loadData();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo cargar la evidencia"
      );
    } finally {
      setUploadingEvidenceId(null);
    }
  };

  const openClosureEvidenceFile = async (item: ActionPlanItem) => {
    if (!item.closure_evidence_path) return;

    setOpeningEvidence(item.closure_evidence_path);

    try {
      const { data, error } = await supabase.storage
        .from("action-plan-files")
        .createSignedUrl(item.closure_evidence_path, 60 * 10);

      if (error) throw error;

      if (!data?.signedUrl) {
        throw new Error("No se pudo abrir la evidencia");
      }

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo abrir la evidencia"
      );
    } finally {
      setOpeningEvidence(null);
    }
  };

  const renderActionPlanItem = (item: ActionPlanItem, index: number) => {
    const referenceText = buildReferenceText(item.reference);
    const hasClosureEvidence = !!item.closure_evidence_path;
    const StatusIcon = statusIcon(item.status);

    return (
      <div key={item.id} className="rounded-lg border bg-background p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-sm font-semibold text-destructive">
            {index + 1}
          </div>

          <div className="flex-1 min-w-64">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Hallazgo
              </span>

              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClass(
                  item.status
                )}`}
              >
                <StatusIcon className="h-3 w-3" />
                {statusLabel(item.status)}
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

            <h4 className="mt-3 text-lg font-semibold tracking-tight">
              {item.question_label}
            </h4>

            <div className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium">Sección: </span>
              {item.section_title}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span>
                <span className="font-medium">Auditor: </span>
                {item.auditor_name}
              </span>
              {item.auditor_email && <span>({item.auditor_email})</span>}
            </div>

            {referenceText && (
              <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Referencia normativa</div>

                <div className="text-muted-foreground">{referenceText}</div>

                {item.reference?.requirement && (
                  <div className="mt-1 text-muted-foreground">
                    {item.reference.requirement}
                  </div>
                )}
              </div>
            )}

            {(item.risk?.title || item.risk?.description) && (
              <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Riesgo asociado</div>

                {item.risk?.title && (
                  <div className="text-muted-foreground">
                    {item.risk.title}
                  </div>
                )}

                {item.risk?.description && (
                  <p className="mt-1 text-muted-foreground">
                    {item.risk.description}
                  </p>
                )}
              </div>
            )}

            {item.finding_comment && (
              <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Comentario del hallazgo</div>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {item.finding_comment}
                </p>
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Acciones recomendadas</div>

                {item.recommended_actions.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {item.recommended_actions.map((action, actionIndex) => (
                      <li key={actionIndex}>{action}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted-foreground">
                    No se registraron acciones recomendadas.
                  </p>
                )}
              </div>

              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Evidencia esperada</div>

                {item.expected_evidence.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {item.expected_evidence.map((evidence, evidenceIndex) => (
                      <li key={evidenceIndex}>{evidence}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted-foreground">
                    Documento, registro, captura, fotografía o validación que
                    demuestre la corrección.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 rounded-md border p-4">
              <div className="mb-3 font-medium">Completar action plan</div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Acción correctiva</Label>
                  <Textarea
                    value={item.corrective_action ?? ""}
                    onChange={(e) =>
                      updateItem(item.id, {
                        corrective_action: e.target.value,
                      })
                    }
                    placeholder="Describe la acción correctiva"
                    rows={3}
                    maxLength={3000}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Responsable</Label>
                  <Input
                    value={item.responsible_name ?? ""}
                    onChange={(e) =>
                      updateItem(item.id, {
                        responsible_name: e.target.value,
                      })
                    }
                    placeholder="Nombre del responsable"
                    maxLength={200}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Fecha compromiso</Label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="date"
                      className="pl-9"
                      value={item.due_date ?? ""}
                      onChange={(e) =>
                        updateItem(item.id, {
                          due_date: e.target.value || null,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Estado</Label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={item.status}
                    onChange={(e) =>
                      updateItem(item.id, {
                        status: e.target.value as ActionPlanStatus,
                      })
                    }
                  >
                    <option value="pending">Pendiente</option>
                    <option value="in_progress">En progreso</option>
                    <option value="closed">Cerrado</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <Label>Comentario de cierre</Label>
                  <Textarea
                    value={item.closure_comment ?? ""}
                    onChange={(e) =>
                      updateItem(item.id, {
                        closure_comment: e.target.value,
                      })
                    }
                    placeholder="Describe cómo se corrigió o cerró el hallazgo"
                    rows={3}
                    maxLength={3000}
                  />
                </div>
              </div>

              <div className="mt-4 rounded-md border bg-muted/30 p-3">
                <div className="mb-2 flex items-center gap-1 font-medium text-sm">
                  <FileImage className="h-4 w-4" />
                  Evidencia de cierre
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) =>
                        e.target.files?.[0] &&
                        uploadClosureEvidence(item, e.target.files[0])
                      }
                    />

                    <span className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                      <Upload className="h-4 w-4" />
                      {uploadingEvidenceId === item.id
                        ? "Uploading…"
                        : hasClosureEvidence
                          ? "Replace evidence"
                          : "Upload evidence"}
                    </span>
                  </label>

                  {hasClosureEvidence && (
                    <>
                      <span className="max-w-xs truncate text-sm text-muted-foreground">
                        {item.closure_evidence_name ||
                          item.closure_evidence_path?.split("/").pop()}
                      </span>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openClosureEvidenceFile(item)}
                        disabled={
                          openingEvidence === item.closure_evidence_path
                        }
                      >
                        <Eye className="mr-1 h-4 w-4" />
                        {openingEvidence === item.closure_evidence_path
                          ? "Opening…"
                          : "Open evidence"}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <Button
                  onClick={() => saveItem(item)}
                  disabled={savingId === item.id}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {savingId === item.id ? "Saving…" : "Guardar action plan"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (authLoading || loading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  if (!canView) {
    return (
      <div className="container mx-auto max-w-5xl py-8">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/surveys">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to surveys
          </Link>
        </Button>

        <div className="mt-6 rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 text-destructive font-semibold">
            <AlertTriangle className="h-5 w-5" />
            Access denied
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            Solo los usuarios con rol Admin o Lead Auditor pueden acceder a
            Action Plans.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ListTodo className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {isSurveyDetailWindow ? "Action Plans del Survey" : "Action Plans"}
            </h1>
          </div>

          <p className="mt-1 text-muted-foreground">
            {isSurveyDetailWindow
              ? selectedSurveyTitle ||
                "Detalle de los planes de acción del Survey seleccionado."
              : "Gestiona los planes de acción generados desde los hallazgos de los Surveys, agrupados por Audit y Survey."}
          </p>
        </div>

        <Button variant="outline" asChild>
          <Link to={isSurveyDetailWindow ? "/action-plans" : "/surveys"}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {isSurveyDetailWindow ? "Back to Action Plans" : "Back to surveys"}
          </Link>
        </Button>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-5">
        <div
          className="rounded-lg border bg-card p-5"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Total
          </div>
          <div className="mt-2 text-3xl font-semibold">{stats.total}</div>
        </div>

        <div
          className="rounded-lg border bg-card p-5"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pendientes
          </div>
          <div className="mt-2 text-3xl font-semibold">{stats.pending}</div>
        </div>

        <div
          className="rounded-lg border bg-card p-5"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            En progreso
          </div>
          <div className="mt-2 text-3xl font-semibold">{stats.inProgress}</div>
        </div>

        <div
          className="rounded-lg border bg-card p-5"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cerrados
          </div>
          <div className="mt-2 text-3xl font-semibold">{stats.closed}</div>
        </div>

        <div
          className="rounded-lg border bg-card p-5"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cancelados
          </div>
          <div className="mt-2 text-3xl font-semibold">{stats.cancelled}</div>
        </div>
      </div>

      <div
        className="mb-6 rounded-lg border bg-card p-5"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div className="space-y-1.5">
            <Label>Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar por audit, survey, pregunta, auditor, responsable, acción..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Estado</Label>
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <select
                className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as StatusFilter)
                }
              >
                <option value="all">Todos</option>
                <option value="pending">Pendiente</option>
                <option value="in_progress">En progreso</option>
                <option value="closed">Cerrado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {groupedByAudit.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-16 text-center text-muted-foreground">
          <ListTodo className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          No hay action plans para mostrar con el filtro actual.
        </div>
      ) : (
        <div className="space-y-8">
          {groupedByAudit.map((auditGroup) => (
            <div key={auditGroup.auditId ?? "no-audit"} className="space-y-4">
              <div
                className="rounded-lg border bg-card p-5"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <FolderKanban className="h-5 w-5 text-muted-foreground" />
                      <h2 className="text-xl font-semibold tracking-tight">
                        {auditGroup.auditName}
                      </h2>
                    </div>

                    <p className="mt-1 text-sm text-muted-foreground">
                      {auditGroup.surveys.length} survey(s),{" "}
                      {auditGroup.totalItems} action plan(s).
                    </p>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm ${
                      auditGroup.progressPercent === 100
                        ? "bg-success/15 text-success"
                        : "bg-warning/15 text-warning-foreground"
                    }`}
                  >
                    {auditGroup.progressPercent === 100 ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <Clock className="h-3.5 w-3.5" />
                    )}
                    {auditGroup.progressPercent}% cerrado
                  </span>
                </div>

                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Cerrados: {auditGroup.closedItems} /{" "}
                    {auditGroup.totalItems}
                  </span>
                  <span>
                    Pendientes: {auditGroup.pendingItems} · En progreso:{" "}
                    {auditGroup.inProgressItems}
                  </span>
                </div>

                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full ${progressClass(
                      auditGroup.progressPercent
                    )}`}
                    style={{
                      width: `${auditGroup.progressPercent}%`,
                    }}
                  />
                </div>
              </div>

              {isSurveyDetailWindow ? (
                <div className="space-y-6">
                  {auditGroup.surveys.map((surveyGroup) => (
                    <div
                      key={surveyGroup.surveyId}
                      className="rounded-lg border bg-card p-6"
                      style={{ boxShadow: "var(--shadow-card)" }}
                    >
                      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                            <h3 className="text-xl font-semibold tracking-tight">
                              {surveyGroup.surveyTitle}
                            </h3>
                          </div>

                          <p className="mt-1 text-sm text-muted-foreground">
                            {surveyGroup.totalItems} action plan(s) generados por
                            hallazgos del survey.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm ${
                              surveyGroup.progressPercent === 100
                                ? "bg-success/15 text-success"
                                : "bg-warning/15 text-warning-foreground"
                            }`}
                          >
                            {surveyGroup.progressPercent === 100 ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <Clock className="h-3.5 w-3.5" />
                            )}
                            {surveyGroup.progressPercent}% cerrado
                          </span>

                          <Button variant="outline" size="sm" asChild>
                            <Link
                              to="/surveys/$id/progress"
                              params={{ id: surveyGroup.surveyId }}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View progress
                            </Link>
                          </Button>
                        </div>
                      </div>

                      <div className="mb-5 space-y-2">
                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <span>
                            Cerrados: {surveyGroup.closedItems} /{" "}
                            {surveyGroup.totalItems}
                          </span>
                          <span>
                            Pendientes: {surveyGroup.pendingItems} · En progreso:{" "}
                            {surveyGroup.inProgressItems} · Cancelados:{" "}
                            {surveyGroup.cancelledItems}
                          </span>
                        </div>

                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-full ${progressClass(
                              surveyGroup.progressPercent
                            )}`}
                            style={{
                              width: `${surveyGroup.progressPercent}%`,
                            }}
                          />
                        </div>
                      </div>

                      <div className="space-y-5">
                        {surveyGroup.items.map((item, index) =>
                          renderActionPlanItem(item, index)
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {auditGroup.surveys.map((surveyGroup) => (
                    <div
                      key={surveyGroup.surveyId}
                      className="flex min-h-[280px] flex-col rounded-lg border bg-card p-5"
                      style={{ boxShadow: "var(--shadow-card)" }}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />

                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm ${
                            surveyGroup.progressPercent === 100
                              ? "bg-success/15 text-success"
                              : "bg-warning/15 text-warning-foreground"
                          }`}
                        >
                          {surveyGroup.progressPercent === 100 ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <Clock className="h-3.5 w-3.5" />
                          )}
                          {surveyGroup.progressPercent}% cerrado
                        </span>
                      </div>

                      <h3 className="line-clamp-2 text-lg font-semibold tracking-tight">
                        {surveyGroup.surveyTitle}
                      </h3>

                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {surveyGroup.totalItems} action plan(s) generados por
                        hallazgos del survey.
                      </p>

                      <div className="mt-auto pt-4">
                        <div className="mb-4 space-y-2">
                          <div className="flex items-center justify-between text-sm text-muted-foreground">
                            <span>Cerrados</span>
                            <span>
                              {surveyGroup.closedItems} /{" "}
                              {surveyGroup.totalItems}
                            </span>
                          </div>

                          <div className="h-2 rounded-full bg-secondary overflow-hidden">
                            <div
                              className={`h-full ${progressClass(
                                surveyGroup.progressPercent
                              )}`}
                              style={{
                                width: `${surveyGroup.progressPercent}%`,
                              }}
                            />
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div className="rounded-md border bg-muted/30 px-2 py-1 text-center">
                              Pend. {surveyGroup.pendingItems}
                            </div>
                            <div className="rounded-md border bg-muted/30 px-2 py-1 text-center">
                              Prog. {surveyGroup.inProgressItems}
                            </div>
                            <div className="rounded-md border bg-muted/30 px-2 py-1 text-center">
                              Canc. {surveyGroup.cancelledItems}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              to="/surveys/$id/progress"
                              params={{ id: surveyGroup.surveyId }}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View progress
                            </Link>
                          </Button>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              openSurveyActionPlans(surveyGroup.surveyId)
                            }
                          >
                            <ListTodo className="mr-2 h-4 w-4" />
                            Action Plans
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
