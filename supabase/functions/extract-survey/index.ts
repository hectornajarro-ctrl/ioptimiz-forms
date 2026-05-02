// Extract structured compliance audit schema from a PDF using Lovable AI

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
      "Convert an audit, checklist, regulation, policy or standard PDF into a structured compliance audit form schema with summary, audit objective, auditor actions, sections, questions, normative references, risks, recommended actions and expected evidence.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the survey/audit.",
        },
        description: {
          type: "string",
          description: "One-sentence description of the audit.",
        },
        summary: {
          type: "string",
          description:
            "Clear Spanish summary of what the PDF says, focused on what matters for the audit.",
        },
        auditor_objective: {
          type: "string",
          description:
            "Main audit objective in Spanish. Explain what the auditor must verify based on the PDF.",
        },
        auditor_actions: {
          type: "array",
          items: { type: "string" },
          description:
            "Suggested practical actions in Spanish that the auditor should perform before or during the audit.",
        },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Audit section title.",
              },
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description:
                        "The audit question in Spanish. Phrase it so Yes means compliant and No means non-compliant.",
                    },
                    type: {
                      type: "string",
                      enum: ["yes_no"],
                      description: "Always use yes_no for compliance audits.",
                    },
                    required: {
                      type: "boolean",
                    },
                    options: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Keep empty. The app automatically uses Yes, No and N/A.",
                    },
                    scale_max: {
                      type: "number",
                      description:
                        "Keep 5 for compatibility. Ignored in compliance mode.",
                    },
                    reference: {
                      type: "object",
                      description:
                        "Normative or regulatory reference that supports the question.",
                      properties: {
                        source_title: {
                          type: "string",
                          description:
                            "Name of the regulation, policy, standard or document if available.",
                        },
                        section: {
                          type: "string",
                          description:
                            "Section, chapter, clause, article or numeral from the source document.",
                        },
                        page: {
                          type: "string",
                          description:
                            "Page number or page range if identifiable.",
                        },
                        requirement: {
                          type: "string",
                          description:
                            "Short Spanish summary of the requirement that must be verified.",
                        },
                        source_text: {
                          type: "string",
                          description:
                            "Brief relevant excerpt or paraphrase from the PDF. Keep it short.",
                        },
                      },
                    },
                    risk: {
                      type: "object",
                      description:
                        "Risk associated with a finding or non-compliance. Usually triggered when the answer is No.",
                      properties: {
                        title: {
                          type: "string",
                          description: "Short risk title.",
                        },
                        description: {
                          type: "string",
                          description:
                            "Risk description if the requirement is not met.",
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
                        },
                      },
                    },
                    recommended_actions: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Corrective or preventive actions recommended if a finding is detected.",
                    },
                    expected_evidence: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Documents, records, screenshots, photos or other evidence the auditor should review.",
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

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
}

function cleanObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const obj = value as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(obj)) {
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "string" && raw.trim() === "") continue;

    cleaned[key] = typeof raw === "string" ? raw.trim() : raw;
  }

  return Object.keys(cleaned).length ? cleaned : undefined;
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
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

  return `El PDF contiene requisitos y criterios de cumplimiento que deben ser verificados durante la auditoría. La IA identificó ${questionCount} pregunta(s) auditable(s) organizadas en ${sections.length} sección(es).${topics}`;
}

function buildFallbackObjective(sections: any[]): string {
  const questionCount = sections.reduce(
    (sum, section) => sum + (section.questions?.length ?? 0),
    0
  );

  if (questionCount === 0) {
    return "Revisar el PDF y confirmar manualmente los requisitos que deben convertirse en controles o preguntas de auditoría.";
  }

  return "Verificar que la organización cumpla con los requisitos identificados en el PDF, revisando evidencias, responsables, registros y controles asociados a cada pregunta de auditoría.";
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
    "Registrar los hallazgos cuando una respuesta sea No o exista evidencia insuficiente.",
    "Definir acciones correctivas para cada incumplimiento identificado.",
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { surveyId } = await req.json();

    if (!surveyId) throw new Error("surveyId required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) throw new Error("Unauthorized");

    const userClient = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY") ??
        Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
        "",
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    const { data: userRes } = await userClient.auth.getUser();
    const userId = userRes?.user?.id;

    if (!userId) throw new Error("Unauthorized");

    const { data: survey, error: sErr } = await admin
      .from("surveys")
      .select("id, pdf_path, title, lead_auditor_id")
      .eq("id", surveyId)
      .single();

    if (sErr || !survey) throw new Error("Survey not found");

    if (survey.lead_auditor_id !== userId) {
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();

      if (!roleRow) throw new Error("Forbidden");
    }

    if (!survey.pdf_path) throw new Error("No PDF uploaded");

    const { data: blob, error: dlErr } = await admin.storage
      .from("survey-pdfs")
      .download(survey.pdf_path);

    if (dlErr || !blob) throw new Error("Could not download PDF");

    const buf = new Uint8Array(await blob.arrayBuffer());

    let binary = "";

    for (let i = 0; i < buf.length; i++) {
      binary += String.fromCharCode(buf[i]);
    }

    const b64 = btoa(binary);

    const systemPrompt = `
You are an expert compliance auditor.

The PDF may contain regulations, standards, policies, legal requirements, operational procedures, technical requirements, internal controls or audit criteria.

Important language rule:
- Generate all user-facing text in Spanish.
- Keep risk enum values exactly as requested: Low, Medium, High, Critical.

Your task:
1. Identify auditable obligations from the document.
2. Convert each obligation into a Yes/No audit question.
3. Phrase every question so that:
   - Yes = compliant
   - No = finding / non-compliance
   - N/A = not applicable
4. Do not create questions for comments or evidence. The app already supports comments and evidence.
5. For every question, include:
   - reference.source_title if available
   - reference.section, article, clause or numeral if available
   - reference.page if identifiable
   - reference.requirement as a short summary of the requirement
   - reference.source_text as a short relevant excerpt or paraphrase
6. For every question, create a risk that may arise if the auditor answers No.
7. For every risk, include category, severity, likelihood and impact.
8. Include recommended corrective/preventive actions.
9. Include expected evidence the auditor should review.
10. Be thorough, but do not invent requirements not supported by the PDF.
11. Risks and actions may be professional suggestions based on the extracted requirement, but the requirement itself must come from the PDF.
12. Always return questions with type = "yes_no".
13. Return structured JSON only through the function tool.
14. You MUST generate a non-empty "summary".
15. You MUST generate a non-empty "auditor_objective".
16. You MUST generate at least 5 items in "auditor_actions".
17. The suggested auditor actions must be concrete, for example: review documents, interview responsible people, inspect evidence, validate logs, verify approvals, check dates, confirm responsibilities or request missing records.
`;

    const userInstruction =
      "Extrae un cuestionario completo de auditoría de cumplimiento desde este PDF. Incluye obligatoriamente resumen del PDF, objetivo del auditor, acciones sugeridas para el auditor, referencias normativas, riesgos por hallazgos, acciones recomendadas y evidencias esperadas por cada pregunta.";

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
      const t = await aiRes.text();

      console.error("AI gateway error", aiRes.status, t);

      if (aiRes.status === 429) {
        return new Response(
          JSON.stringify({
            error: "Rate limit reached. Please try again shortly.",
          }),
          {
            status: 429,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({
            error: "AI credits exhausted. Add credits in workspace settings.",
          }),
          {
            status: 402,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      throw new Error("AI extraction failed");
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("AI did not return a structured response");
    }

    const args = JSON.parse(toolCall.function.arguments);

    const sections = (args.sections ?? []).map((sec: any, si: number) => ({
      id: `s${si}_${crypto.randomUUID().slice(0, 8)}`,
      title: String(sec.title ?? `Section ${si + 1}`).trim(),
      questions: (sec.questions ?? []).map((q: any, qi: number) => ({
        id: `q${si}_${qi}_${crypto.randomUUID().slice(0, 8)}`,
        label: String(q.label ?? `Question ${qi + 1}`).trim(),
        type: "yes_no",
        required: q.required ?? true,
        options: [],
        scale_max: 5,
        reference: cleanObject(q.reference),
        risk: cleanObject(q.risk),
        recommended_actions: asArray(q.recommended_actions),
        expected_evidence: asArray(q.expected_evidence),
      })),
    }));

    const aiAuditorActions = asArray(args.auditor_actions);

    const schema = {
      summary: normalizeString(args.summary) || buildFallbackSummary(sections),
      auditor_objective:
        normalizeString(args.auditor_objective) ||
        buildFallbackObjective(sections),
      auditor_actions:
        aiAuditorActions.length > 0
          ? aiAuditorActions
          : buildFallbackActions(sections),
      sections,
    };

    const update: any = {
      mode: "compliance",
      schema,
    };

    if (args.title && (!survey.title || survey.title === "Untitled survey")) {
      update.title = args.title;
    }

    if (args.description) {
      update.description = args.description;
    }

    const { error: upErr } = await admin
      .from("surveys")
      .update(update)
      .eq("id", surveyId);

    if (upErr) throw upErr;

    const questionCount = sections.reduce(
      (sum: number, section: any) => sum + (section.questions?.length ?? 0),
      0
    );

    return new Response(
      JSON.stringify({
        success: true,
        sections: sections.length,
        questions: questionCount,
        has_summary: Boolean(schema.summary),
        has_auditor_objective: Boolean(schema.auditor_objective),
        auditor_actions: schema.auditor_actions.length,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (e) {
    console.error("extract-survey error:", e);

    const msg = e instanceof Error ? e.message : "Unknown error";

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
});
