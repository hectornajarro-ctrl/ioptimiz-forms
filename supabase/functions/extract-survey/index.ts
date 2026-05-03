// Extract structured compliance audit schema from a PDF using Lovable AI.
// Optimized version: generates questions, references, basic risks, impacts,
// recommended actions and expected evidence without overloading the AI request.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FORM_SCHEMA_TOOL = {
  type: "function",
  function: {
    name: "build_form_schema",
    description:
      "Convert an audit, checklist, regulation, policy or standard PDF into a structured compliance audit form schema with summary, objective, auditor actions, sections, questions, references, basic risks, impacts, recommended actions and expected evidence.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short audit/survey title in Spanish.",
        },
        description: {
          type: "string",
          description: "One-sentence audit description in Spanish.",
        },
        summary: {
          type: "string",
          description:
            "Short Spanish summary of what the PDF says and what it regulates or requires.",
        },
        auditor_objective: {
          type: "string",
          description:
            "Main audit objective in Spanish. Explain what the auditor must verify.",
        },
        auditor_actions: {
          type: "array",
          items: { type: "string" },
          description:
            "Practical actions the auditor should perform. Keep each action concise.",
        },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Section title in Spanish.",
              },
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description:
                        "Audit question in Spanish. Phrase it so Yes means compliant and No means non-compliant.",
                    },
                    type: {
                      type: "string",
                      enum: ["yes_no"],
                      description: "Always yes_no.",
                    },
                    required: {
                      type: "boolean",
                      description: "Usually true.",
                    },
                    reference: {
                      type: "object",
                      description:
                        "Normative or regulatory reference that supports the question.",
                      properties: {
                        source_title: {
                          type: "string",
                          description:
                            "Name of the regulation, standard, policy or document.",
                        },
                        section: {
                          type: "string",
                          description:
                            "Section, chapter, clause, article or numeral.",
                        },
                        page: {
                          type: "string",
                          description: "Page number if identifiable.",
                        },
                        requirement: {
                          type: "string",
                          description:
                            "Short Spanish summary of the requirement.",
                        },
                        source_text: {
                          type: "string",
                          description:
                            "Very short relevant excerpt or paraphrase.",
                        },
                      },
                    },
                    risk: {
                      type: "object",
                      description:
                        "Basic risk associated with a No answer or finding.",
                      properties: {
                        title: {
                          type: "string",
                          description: "Short Spanish risk title.",
                        },
                        description: {
                          type: "string",
                          description:
                            "Concise Spanish explanation of the risk if the requirement is not met.",
                        },
                        category: {
                          type: "string",
                          enum: [
                            "Legal",
                            "Compliance",
                            "Operational",
                            "Financial",
                            "Security",
                            "Reputational",
                            "Environmental",
                            "Safety",
                            "Quality",
                            "Other",
                          ],
                        },
                        severity: {
                          type: "string",
                          enum: ["Low", "Medium", "High", "Critical"],
                        },
                        likelihood: {
                          type: "string",
                          enum: ["Low", "Medium", "High"],
                        },
                        impact: {
                          type: "string",
                          enum: ["Low", "Medium", "High"],
                          description:
                            "Business, operational, legal, reputational, safety or continuity impact level.",
                        },
                      },
                    },
                    recommended_actions: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Specific corrective or preventive actions if a finding is detected. Keep concise.",
                    },
                    expected_evidence: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Evidence the auditor should review: records, documents, screenshots, logs, photos or approvals.",
                    },
                  },
                  required: [
                    "label",
                    "type",
                    "reference",
                    "risk",
                    "recommended_actions",
                    "expected_evidence",
                  ],
                },
              },
            },
            required: ["title", "questions"],
          },
        },
      },
      required: [
        "title",
        "description",
        "summary",
        "auditor_objective",
        "auditor_actions",
        "sections",
      ],
    },
  },
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
    .filter((item) => item.length > 0);
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const obj = value as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(obj)) {
    if (raw === null || raw === undefined) continue;

    if (typeof raw === "string") {
      const clean = raw.trim();
      if (!clean) continue;
      cleaned[key] = clean;
      continue;
    }

    if (Array.isArray(raw)) {
      const arr = asArray(raw);
      if (arr.length === 0) continue;
      cleaned[key] = arr;
      continue;
    }

    cleaned[key] = raw;
  }

  return Object.keys(cleaned).length ? cleaned : undefined;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function getSectionTitles(sections: any[]): string[] {
  return sections
    .map((section) => String(section.title ?? "").trim())
    .filter(Boolean);
}

function collectActionsFromSections(sections: any[]): string[] {
  const seen = new Set<string>();
  const actions: string[] = [];

  for (const section of sections) {
    for (const question of section.questions ?? []) {
      for (const action of question.recommended_actions ?? []) {
        const clean = String(action ?? "").trim();
        const key = clean.toLowerCase();

        if (clean && !seen.has(key)) {
          seen.add(key);
          actions.push(clean);
        }
      }
    }
  }

  return actions.slice(0, 8);
}

function buildFallbackSummary(sections: any[]): string {
  const questionCount = sections.reduce(
    (sum, section) => sum + (section.questions?.length ?? 0),
    0
  );

  const sectionTitles = getSectionTitles(sections).slice(0, 5);

  if (questionCount === 0) {
    return "El PDF fue procesado, pero no se identificaron preguntas auditables suficientes. Se recomienda revisar manualmente el documento y volver a ejecutar la extracción si corresponde.";
  }

  const topics =
    sectionTitles.length > 0
      ? ` Los principales temas identificados son: ${sectionTitles.join(", ")}.`
      : "";

  return `El PDF contiene requisitos y criterios de cumplimiento que deben verificarse durante la auditoría. La IA identificó ${questionCount} pregunta(s) auditable(s) organizadas en ${sections.length} sección(es).${topics}`;
}

function buildFallbackObjective(sections: any[]): string {
  const questionCount = sections.reduce(
    (sum, section) => sum + (section.questions?.length ?? 0),
    0
  );

  if (questionCount === 0) {
    return "Revisar el PDF y confirmar manualmente los requisitos que deben convertirse en controles o preguntas de auditoría.";
  }

  return "Verificar que la organización cumpla con los requisitos identificados en el PDF, revisando evidencias, responsables, registros, controles asociados, riesgos de incumplimiento e impacto para la operación.";
}

function buildFallbackActions(sections: any[]): string[] {
  const actionsFromQuestions = collectActionsFromSections(sections);

  if (actionsFromQuestions.length > 0) {
    return actionsFromQuestions;
  }

  return [
    "Revisar el documento normativo y confirmar el alcance de la auditoría.",
    "Solicitar políticas, procedimientos y registros relacionados con los requisitos identificados.",
    "Entrevistar a los responsables de los procesos auditados.",
    "Validar evidencias documentales, fechas, aprobaciones y responsables.",
    "Evaluar el riesgo e impacto de cada incumplimiento identificado.",
    "Registrar hallazgos cuando una respuesta sea No o exista evidencia insuficiente.",
    "Definir acciones correctivas para cada incumplimiento identificado.",
  ];
}

function buildFallbackReference(questionLabel: string): Record<string, unknown> {
  return {
    source_title: "Documento PDF cargado",
    section: "",
    page: "",
    requirement: questionLabel,
    source_text: "",
  };
}

function buildFallbackRisk(questionLabel: string): Record<string, unknown> {
  return {
    title: "Riesgo de incumplimiento del requisito auditado",
    description: `Si no se cumple el requisito asociado a la pregunta "${questionLabel}", la organización podría quedar expuesta a incumplimientos normativos, debilidades de control, falta de trazabilidad y observaciones durante auditorías internas o externas.`,
    category: "Compliance",
    severity: "Medium",
    likelihood: "Medium",
    impact: "Medium",
  };
}

function normalizeRisk(questionLabel: string, value: unknown) {
  const risk = cleanObject(value) ?? {};
  const normalized: Record<string, unknown> = {
    ...buildFallbackRisk(questionLabel),
    ...risk,
  };

  normalized.title =
    normalizeString(normalized.title) ||
    "Riesgo de incumplimiento del requisito auditado";

  normalized.description =
    normalizeString(normalized.description) ||
    `Si no se cumple el requisito asociado a la pregunta "${questionLabel}", la organización podría quedar expuesta a incumplimientos normativos o debilidades de control.`;

  normalized.category = normalizeString(normalized.category) || "Compliance";
  normalized.severity = normalizeString(normalized.severity) || "Medium";
  normalized.likelihood = normalizeString(normalized.likelihood) || "Medium";
  normalized.impact = normalizeString(normalized.impact) || "Medium";

  return normalized;
}

function buildFallbackRecommendedActions(questionLabel: string): string[] {
  return [
    `Analizar la causa raíz asociada al incumplimiento de: ${questionLabel}`,
    "Definir una acción correctiva específica, responsable y fecha compromiso.",
    "Actualizar o formalizar el procedimiento, registro o control aplicable.",
    "Recolectar evidencia objetiva que demuestre la corrección del hallazgo.",
    "Validar la efectividad de la acción correctiva antes del cierre.",
  ];
}

function buildFallbackExpectedEvidence(): string[] {
  return [
    "Procedimiento, política o instructivo actualizado.",
    "Registro o evidencia documental del control aplicado.",
    "Aprobaciones, responsables y fechas de implementación.",
    "Evidencia fotográfica, captura, reporte o registro del sistema si corresponde.",
    "Validación del auditor sobre la efectividad de la corrección.",
  ];
}

function limitArray(values: string[], max: number): string[] {
  return values.slice(0, max);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders,
    });
  }

  try {
    const { surveyId } = await req.json();

    if (!surveyId) {
      return jsonResponse({ error: "surveyId required" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ANON_KEY =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      "";
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
      return jsonResponse(
        {
          error: "Supabase environment variables are not configured",
        },
        500
      );
    }

    if (!LOVABLE_API_KEY) {
      return jsonResponse(
        {
          error: "LOVABLE_API_KEY not configured",
        },
        500
      );
    }

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: userRes, error: userErr } = await userClient.auth.getUser();

    const userId = userRes?.user?.id;

    if (userErr || !userId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { data: survey, error: sErr } = await admin
      .from("surveys")
      .select("id, pdf_path, title, lead_auditor_id")
      .eq("id", surveyId)
      .single();

    if (sErr || !survey) {
      return jsonResponse({ error: "Survey not found" }, 404);
    }

    if (survey.lead_auditor_id !== userId) {
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();

      if (!roleRow) {
        return jsonResponse({ error: "Forbidden" }, 403);
      }
    }

    if (!survey.pdf_path) {
      return jsonResponse({ error: "No PDF uploaded" }, 400);
    }

    const { data: blob, error: dlErr } = await admin.storage
      .from("survey-pdfs")
      .download(survey.pdf_path);

    if (dlErr || !blob) {
      return jsonResponse({ error: "Could not download PDF" }, 500);
    }

    const fileSizeMb = blob.size / 1024 / 1024;

    if (fileSizeMb > 15) {
      return jsonResponse(
        {
          error:
            "PDF too large. Please upload a PDF smaller than 15 MB or split the document.",
        },
        413
      );
    }

    const buf = new Uint8Array(await blob.arrayBuffer());
    const b64 = uint8ToBase64(buf);

    const systemPrompt = `
You are an expert compliance auditor and risk analyst.

Language:
- Generate all user-facing text in Spanish.
- Keep enum values exactly as requested:
  - severity: Low, Medium, High, Critical
  - likelihood: Low, Medium, High
  - impact: Low, Medium, High

Task:
1. Extract auditable obligations from the PDF.
2. Convert obligations into Yes/No compliance questions.
3. Phrase each question so Yes = compliant and No = finding/non-compliance.
4. Do not create questions only for comments or evidence.
5. Group questions into clear sections.
6. Avoid duplicates.
7. Prioritize the most important and auditable requirements.
8. If the document is long, return a maximum of 80 questions.
9. For each question include a short normative reference.
10. For each question include a basic risk if the answer is No:
   - title
   - description
   - category
   - severity
   - likelihood
   - impact
11. For each question include recommended corrective/preventive actions.
12. For each question include expected evidence.
13. Return concise text. Do not write long executive arguments here.
14. Detailed business impact, benefits and auditor argument will be generated later in Action Plans.
15. Always use type = "yes_no".
16. Return structured JSON only through the function tool.
17. Always generate non-empty summary, auditor_objective and auditor_actions.
`;

    const userInstruction =
      "Extrae un cuestionario de auditoría de cumplimiento desde este PDF. Incluye resumen, objetivo, acciones sugeridas, preguntas, referencias normativas, riesgo básico, severidad, probabilidad, impacto, acciones recomendadas y evidencia esperada.";

    const aiRes = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: userInstruction,
                },
                {
                  type: "file",
                  file: {
                    filename: "survey.pdf",
                    file_data: `data:application/pdf;base64,${b64}`,
                  },
                },
              ],
            },
          ],
          tools: [FORM_SCHEMA_TOOL],
          tool_choice: {
            type: "function",
            function: {
              name: "build_form_schema",
            },
          },
        }),
      }
    );

    if (!aiRes.ok) {
      const text = await aiRes.text();

      console.error("AI gateway error", aiRes.status, text);

      if (aiRes.status === 429) {
        return jsonResponse(
          {
            error: "Rate limit reached. Please try again shortly.",
          },
          429
        );
      }

      if (aiRes.status === 402) {
        return jsonResponse(
          {
            error: "AI credits exhausted. Add credits in workspace settings.",
          },
          402
        );
      }

      return jsonResponse(
        {
          error: "AI extraction failed",
          status: aiRes.status,
          details: text.slice(0, 500),
        },
        500
      );
    }

    const aiJson = await aiRes.json();

    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.error("AI response without tool call", JSON.stringify(aiJson));
      return jsonResponse(
        {
          error: "AI did not return a structured response",
        },
        500
      );
    }

    let args: any;

    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch (parseError) {
      console.error("Tool arguments parse error", parseError);
      console.error("Raw arguments", toolCall.function.arguments);

      return jsonResponse(
        {
          error: "AI returned invalid structured JSON",
        },
        500
      );
    }

    const sections = (args.sections ?? []).map((sec: any, si: number) => {
      const rawQuestions = Array.isArray(sec.questions) ? sec.questions : [];

      return {
        id: `s${si}_${crypto.randomUUID().slice(0, 8)}`,
        title: String(sec.title ?? `Sección ${si + 1}`).trim(),
        questions: rawQuestions.map((q: any, qi: number) => {
          const label = String(q.label ?? `Pregunta ${qi + 1}`).trim();

          const reference =
            cleanObject(q.reference) ?? buildFallbackReference(label);

          const recommendedActions = asArray(q.recommended_actions);
          const expectedEvidence = asArray(q.expected_evidence);

          return {
            id: `q${si}_${qi}_${crypto.randomUUID().slice(0, 8)}`,
            label,
            type: "yes_no",
            required: q.required ?? true,
            options: [],
            scale_max: 5,
            reference,
            risk: normalizeRisk(label, q.risk),
            recommended_actions:
              recommendedActions.length > 0
                ? limitArray(recommendedActions, 6)
                : buildFallbackRecommendedActions(label),
            expected_evidence:
              expectedEvidence.length > 0
                ? limitArray(expectedEvidence, 6)
                : buildFallbackExpectedEvidence(),
          };
        }),
      };
    });

    const filteredSections = sections
      .map((section: any) => ({
        ...section,
        questions: (section.questions ?? []).filter((q: any) =>
          Boolean(String(q.label ?? "").trim())
        ),
      }))
      .filter((section: any) => section.questions.length > 0);

    const aiAuditorActions = asArray(args.auditor_actions);

    const schema = {
      summary:
        normalizeString(args.summary) || buildFallbackSummary(filteredSections),
      auditor_objective:
        normalizeString(args.auditor_objective) ||
        buildFallbackObjective(filteredSections),
      auditor_actions:
        aiAuditorActions.length > 0
          ? limitArray(aiAuditorActions, 8)
          : buildFallbackActions(filteredSections),
      sections: filteredSections,
    };

    const update: Record<string, unknown> = {
      mode: "compliance",
      schema,
    };

    const generatedTitle = normalizeString(args.title);
    const generatedDescription = normalizeString(args.description);

    if (
      generatedTitle &&
      (!survey.title || survey.title === "Untitled survey")
    ) {
      update.title = generatedTitle;
    }

    if (generatedDescription) {
      update.description = generatedDescription;
    }

    const { error: upErr } = await admin
      .from("surveys")
      .update(update)
      .eq("id", surveyId);

    if (upErr) {
      return jsonResponse(
        {
          error: upErr.message,
        },
        500
      );
    }

    const questionCount = filteredSections.reduce(
      (sum: number, section: any) => sum + (section.questions?.length ?? 0),
      0
    );

    return jsonResponse({
      success: true,
      sections: filteredSections.length,
      questions: questionCount,
      has_summary: Boolean(schema.summary),
      has_auditor_objective: Boolean(schema.auditor_objective),
      auditor_actions: schema.auditor_actions.length,
      has_risks: filteredSections.some((section: any) =>
        section.questions?.some((question: any) => Boolean(question.risk))
      ),
      has_impacts: filteredSections.some((section: any) =>
        section.questions?.some((question: any) =>
          Boolean(question.risk?.impact)
        )
      ),
    });
  } catch (error) {
    console.error("extract-survey unexpected error:", error);

    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});
