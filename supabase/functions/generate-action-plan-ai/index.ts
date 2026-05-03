import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ActionPlanStatus = "pending" | "in_progress" | "closed" | "cancelled";

interface ActionPlanItem {
  id: string;
  survey_id: string;
  survey_response_id: string | null;
  auditor_id: string | null;
  question_id: string;
  section_title: string | null;
  question_label: string | null;
  reference: Record<string, unknown> | null;
  risk: Record<string, unknown> | null;
  finding_comment: string | null;
  recommended_actions: string[] | null;
  expected_evidence: string[] | null;
  corrective_action: string | null;
  responsible_name: string | null;
  due_date: string | null;
  status: ActionPlanStatus;
}

interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  schema: {
    summary?: string;
    auditor_objective?: string;
    auditor_actions?: string[];
    sections?: Array<{
      id: string;
      title: string;
      questions: Array<{
        id: string;
        label?: string;
        reference?: Record<string, unknown>;
        risk?: Record<string, unknown>;
        recommended_actions?: string[];
        expected_evidence?: string[];
      }>;
    }>;
  } | null;
  lead_auditor_id: string;
  pdf_path: string | null;
}

interface AIActionPlanResult {
  id: string;
  risk: {
    title?: string;
    description?: string;
    category?: string;
    severity?: string;
    likelihood?: string;
    impact?: string;
  };
  recommended_actions: string[];
  expected_evidence: string[];
  ai_risk_summary: string;
  ai_business_impact: string;
  ai_benefits: string[];
  ai_auditor_argument: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compact).filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};

    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      if (
        val === undefined ||
        val === null ||
        val === "" ||
        (Array.isArray(val) && val.length === 0)
      ) {
        return;
      }

      output[key] = compact(val);
    });

    return output;
  }

  return value;
}

function findQuestionFromSchema(survey: SurveyRow, questionId: string) {
  const sections = survey.schema?.sections ?? [];

  for (const section of sections) {
    const question = section.questions?.find((q) => q.id === questionId);

    if (question) {
      return {
        sectionTitle: section.title,
        question,
      };
    }
  }

  return null;
}

function buildPromptPayload(survey: SurveyRow, items: ActionPlanItem[]) {
  return {
    survey: {
      title: survey.title,
      description: survey.description,
      pdf_path: survey.pdf_path,
      pdf_summary: survey.schema?.summary ?? "",
      auditor_objective: survey.schema?.auditor_objective ?? "",
      auditor_actions: asArray(survey.schema?.auditor_actions),
    },
    findings: items.map((item) => {
      const schemaQuestion = findQuestionFromSchema(survey, item.question_id);

      return compact({
        id: item.id,
        section_title:
          item.section_title || schemaQuestion?.sectionTitle || "Sin sección",
        question: item.question_label || schemaQuestion?.question?.label || "",
        normative_reference:
          item.reference || schemaQuestion?.question?.reference || {},
        current_risk: item.risk || schemaQuestion?.question?.risk || {},
        existing_recommended_actions:
          item.recommended_actions ||
          schemaQuestion?.question?.recommended_actions ||
          [],
        existing_expected_evidence:
          item.expected_evidence ||
          schemaQuestion?.question?.expected_evidence ||
          [],
        auditor_finding_comment: item.finding_comment || "",
        current_corrective_action: item.corrective_action || "",
        current_status: item.status,
      });
    }),
  };
}

function safeJsonParse(content: string): AIActionPlanResult[] {
  const cleaned = content
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned);

  if (Array.isArray(parsed)) {
    return parsed as AIActionPlanResult[];
  }

  if (Array.isArray(parsed.items)) {
    return parsed.items as AIActionPlanResult[];
  }

  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openAiKey = Deno.env.get("OPENAI_API_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(
        {
          error: "Missing Supabase environment variables",
        },
        500
      );
    }

    if (!openAiKey) {
      return jsonResponse(
        {
          error: "Missing OPENAI_API_KEY secret",
        },
        500
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: {
        user,
      },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return jsonResponse(
        {
          error: "Unauthorized",
        },
        401
      );
    }

    const body = await req.json().catch(() => ({}));

    const surveyId = String(body.surveyId ?? "").trim();
    const actionPlanItemId = String(body.actionPlanItemId ?? "").trim();

    if (!surveyId && !actionPlanItemId) {
      return jsonResponse(
        {
          error: "surveyId or actionPlanItemId is required",
        },
        400
      );
    }

    let effectiveSurveyId = surveyId;

    if (!effectiveSurveyId && actionPlanItemId) {
      const { data: itemForSurvey, error: itemForSurveyError } =
        await supabaseAdmin
          .from("action_plan_items")
          .select("survey_id")
          .eq("id", actionPlanItemId)
          .single();

      if (itemForSurveyError || !itemForSurvey) {
        return jsonResponse(
          {
            error: "Action plan item not found",
          },
          404
        );
      }

      effectiveSurveyId = itemForSurvey.survey_id;
    }

    const { data: survey, error: surveyError } = await supabaseAdmin
      .from("surveys")
      .select("id,title,description,schema,lead_auditor_id,pdf_path")
      .eq("id", effectiveSurveyId)
      .single();

    if (surveyError || !survey) {
      return jsonResponse(
        {
          error: "Survey not found",
        },
        404
      );
    }

    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    if (rolesError) {
      return jsonResponse(
        {
          error: rolesError.message,
        },
        500
      );
    }

    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    const isLead = survey.lead_auditor_id === user.id;

    if (!isAdmin && !isLead) {
      return jsonResponse(
        {
          error: "Only Admin or Lead Auditor can generate action plan AI recommendations",
        },
        403
      );
    }

    let actionPlanQuery = supabaseAdmin
      .from("action_plan_items")
      .select("*")
      .eq("survey_id", effectiveSurveyId)
      .order("created_at", {
        ascending: true,
      });

    if (actionPlanItemId) {
      actionPlanQuery = actionPlanQuery.eq("id", actionPlanItemId);
    }

    const { data: actionPlanItems, error: itemsError } =
      await actionPlanQuery;

    if (itemsError) {
      return jsonResponse(
        {
          error: itemsError.message,
        },
        500
      );
    }

    const items = (actionPlanItems ?? []) as ActionPlanItem[];

    if (items.length === 0) {
      return jsonResponse({
        updated: 0,
        message: "No action plan items found",
      });
    }

    const promptPayload = buildPromptPayload(survey as SurveyRow, items);

    const systemPrompt = `
Eres un experto senior en auditoría, cumplimiento normativo, gestión de riesgos y planes de acción.
Tu tarea es enriquecer hallazgos de auditoría con acciones correctivas, riesgos, beneficios y argumentos ejecutivos.

Responde SOLO JSON válido.
No uses markdown.
No inventes normativa no indicada.
Trabaja en español profesional, claro y útil para auditores.
El objetivo es ayudar al auditor a sustentar la no conformidad ante la empresa auditada, explicando riesgos y beneficios de corregirla.

Por cada hallazgo debes devolver:
[
  {
    "id": "id del action_plan_item",
    "risk": {
      "title": "riesgo principal",
      "description": "explicación del riesgo de la no conformidad",
      "category": "categoría del riesgo",
      "severity": "Low | Medium | High | Critical",
      "likelihood": "Low | Medium | High",
      "impact": "Low | Medium | High"
    },
    "recommended_actions": [
      "acción correctiva específica 1",
      "acción correctiva específica 2",
      "acción correctiva específica 3"
    ],
    "expected_evidence": [
      "evidencia esperada 1",
      "evidencia esperada 2"
    ],
    "ai_risk_summary": "resumen ejecutivo del riesgo de mantener esta no conformidad",
    "ai_business_impact": "impacto operativo, legal, reputacional, de seguridad o económico para la organización",
    "ai_benefits": [
      "beneficio de corregir el hallazgo 1",
      "beneficio de corregir el hallazgo 2",
      "beneficio de corregir el hallazgo 3"
    ],
    "ai_auditor_argument": "argumento breve y convincente que el auditor puede usar para explicar a la empresa por qué debe corregirse el hallazgo"
  }
]

Reglas:
- recommended_actions deben ser concretas, auditables y accionables.
- expected_evidence debe ser evidencia verificable.
- No uses frases genéricas si hay contexto específico.
- Si el comentario del auditor es informal, transfórmalo en lenguaje profesional sin cambiar el sentido.
- Si falta contexto, genera recomendaciones prudentes basadas en la pregunta, referencia normativa y objetivo del survey.
`;

    const userPrompt = JSON.stringify(promptPayload, null, 2);

    const openAiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
        }),
      }
    );

    if (!openAiResponse.ok) {
      const errorText = await openAiResponse.text();

      return jsonResponse(
        {
          error: `OpenAI request failed: ${errorText}`,
        },
        500
      );
    }

    const completion = await openAiResponse.json();

    const content =
      completion?.choices?.[0]?.message?.content ??
      "";

    let aiItems: AIActionPlanResult[];

    try {
      aiItems = safeJsonParse(content);
    } catch (_error) {
      return jsonResponse(
        {
          error: "AI response was not valid JSON",
          raw: content,
        },
        500
      );
    }

    const validIds = new Set(items.map((item) => item.id));

    const updates = aiItems.filter((item) => validIds.has(item.id));

    for (const item of updates) {
      const updatePayload = {
        risk: item.risk ?? {},
        recommended_actions: asArray(item.recommended_actions),
        expected_evidence: asArray(item.expected_evidence),
        ai_risk_summary: item.ai_risk_summary ?? null,
        ai_business_impact: item.ai_business_impact ?? null,
        ai_benefits: asArray(item.ai_benefits),
        ai_auditor_argument: item.ai_auditor_argument ?? null,
        ai_generated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabaseAdmin
        .from("action_plan_items")
        .update(updatePayload)
        .eq("id", item.id);

      if (updateError) {
        return jsonResponse(
          {
            error: updateError.message,
          },
          500
        );
      }
    }

    return jsonResponse({
      updated: updates.length,
      total: items.length,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unexpected error",
      },
      500
    );
  }
});
