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
      "Convert an audit, checklist, regulation, policy or standard PDF into a structured compliance audit form schema with summary, audit objective, auditor actions, sections, questions, normative references, risks, impacts, recommended actions and expected evidence.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the survey/audit.",
        },
        description: {
          type: "string",
          description:
            "One-sentence description of the audit, in Spanish.",
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
                      description: "Usually true.",
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
                        "Risk and impact associated with a finding or non-compliance. Usually triggered when the answer is No.",
                      properties: {
                        title: {
                          type: "string",
                          description:
                            "Short Spanish risk title. Must be specific to the question.",
                        },
                        description: {
                          type: "string",
                          description:
                            "Spanish explanation of the risk if the requirement is not met.",
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
                          description:
                            "Severity of the risk if the finding is confirmed.",
                        },
                        likelihood: {
                          type: "string",
                          enum: ["Low", "Medium", "High"],
                          description:
                            "Likelihood that the risk materializes if the organization does not correct the finding.",
                        },
                        impact: {
                          type: "string",
                          enum: ["Low", "Medium", "High"],
                          description:
                            "Impact level for the business, operation, safety, legal compliance, reputation or continuity.",
                        },
                        business_impact: {
                          type: "string",
                          description:
                            "Spanish explanation of the operational, legal, reputational, safety, financial or business impact of not correcting the non-compliance.",
                        },
                        auditor_argument: {
                          type: "string",
                          description:
                            "Short Spanish argument the auditor can use to explain why this finding matters to the audited company.",
                        },
                        benefits_of_correction: {
                          type: "array",
                          items: { type: "string" },
                          description:
                            "Spanish list of benefits of correcting this finding, such as compliance, traceability, safety, continuity, efficiency or risk reduction.",
                        },
                      },
                    },
                    recommended_actions: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Corrective or preventive actions recommended if a finding is detected. Must be specific, auditable and useful.",
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

    if (Array.isArray(raw)) {
      const arr = asArray(raw);
      if (arr.length === 0) continue;
      cleaned[key] = arr;
      continue;
    }

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
    "Registrar los hallazgos cuando una respuesta sea No o exista evidencia insuficiente.",
    "Definir acciones correctivas para cada incumplimiento identificado.",
  ];
}

function buildFallbackRisk(questionLabel: string): Record<string, unknown> {
  return {
    title: "Riesgo de incumplimiento del requisito auditado",
    description: `Si no se cumple el requisito asociado a la pregunta "${questionLabel}", la organización podría quedar expuesta a incumplimientos normativos, debilidades de control, falta de trazabilidad y observaciones durante auditorías internas o externas.`,
    category: "Compliance",
    severity: "Medium",
    likelihood: "Medium",
    impact: "Medium",
    business_impact:
      "La falta de cumplimiento puede afectar la trazabilidad, la capacidad de demostrar controles efectivos, la continuidad operativa y la confianza de partes interesadas, clientes o reguladores.",
    auditor_argument:
      "Este punto debe corregirse porque permite demostrar cumplimiento, reducir exposición a hallazgos recurrentes y fortalecer la evidencia objetiva ante auditorías o inspecciones.",
    benefits_of_correction: [
      "Mejora la evidencia de cumplimiento.",
      "Reduce la probabilidad de observaciones o sanciones.",
      "Fortalece la trazabilidad y responsabilidad del proceso.",
      "Ayuda a prevenir recurrencia del hallazgo.",
    ],
  };
}

function normalizeRisk(questionLabel: string, value: unknown) {
  const risk = cleanObject(value) ?? {};

  const normalized: Record<string, unknown> = {
    ...buildFallbackRisk(questionLabel),
    ...risk,
  };

  normalized.title = normalizeString(normalized.title);
  normalized.description = normalizeString(normalized.description);
  normalized.category = normalizeString(normalized.category) || "Compliance";
  normalized.severity = normalizeString(normalized.severity) || "Medium";
  normalized.likelihood = normalizeString(normalized.likelihood) || "Medium";
  normalized.impact = normalizeString(normalized.impact) || "Medium";
  normalized.business_impact = normalizeString(normalized.business_impact);
  normalized.auditor_argument = normalizeString(normalized.auditor_argument);
  normalized.benefits_of_correction = asArray(
    normalized.benefits_of_correction
  );

  if (!normalized.business_impact) {
    normalized.business_impact =
      "La no conformidad puede afectar el cumplimiento, la trazabilidad, la continuidad operativa, la reputación y la capacidad de demostrar control efectivo ante auditorías o inspecciones.";
  }

  if (!normalized.auditor_argument) {
    normalized.auditor_argument =
      "Corregir este hallazgo permite reducir exposición a riesgos, demostrar control y fortalecer la capacidad de la organización para cumplir con sus obligaciones.";
  }

  if ((normalized.benefits_of_correction as string[]).length === 0) {
    normalized.benefits_of_correction = [
      "Mejora la trazabilidad del cumplimiento.",
      "Reduce la exposición a observaciones o sanciones.",
      "Fortalece el control interno y la evidencia objetiva.",
    ];
  }

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders,
    });
  }

  try {
    const { surveyId } = await req.json();

    if (!surveyId) {
      throw new Error("surveyId required");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      throw new Error("Unauthorized");
    }

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

    if (!userId) {
      throw new Error("Unauthorized");
    }

    const { data: survey, error: sErr } = await admin
      .from("surveys")
      .select("id, pdf_path, title, lead_auditor_id")
      .eq("id", surveyId)
      .single();

    if (sErr || !survey) {
      throw new Error("Survey not found");
    }

    if (survey.lead_auditor_id !== userId) {
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();

      if (!roleRow) {
        throw new Error("Forbidden");
      }
    }

    if (!survey.pdf_path) {
      throw new Error("No PDF uploaded");
    }

    const { data: blob, error: dlErr } = await admin.storage
      .from("survey-pdfs")
      .download(survey.pdf_path);

    if (dlErr || !blob) {
      throw new Error("Could not download PDF");
    }

    const buf = new Uint8Array(await blob.arrayBuffer());

    let binary = "";

    for (let i = 0; i < buf.length; i++) {
      binary += String.fromCharCode(buf[i]);
    }

    const b64 = btoa(binary);

    const systemPrompt = `
You are an expert senior compliance auditor, risk analyst and action plan specialist.

The PDF may contain regulations, standards, policies, legal requirements, operational procedures, technical requirements, internal controls or audit criteria.

Important language rule:
- Generate all user-facing text in Spanish.
- Keep enum values exactly as requested:
  - severity: Low, Medium, High, Critical
  - likelihood: Low, Medium, High
  - impact: Low, Medium, High

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
6. For every question, create a complete risk that may arise if the auditor answers No.
7. For every risk, include:
   - title
   - description
   - category
   - severity
   - likelihood
   - impact
   - business_impact
   - auditor_argument
   - benefits_of_correction
8. The risk must help the auditor explain to the audited company why the finding matters.
9. The business impact must explain operational, legal, safety, financial, reputational, quality or continuity consequences.
10. The auditor argument must be short, professional and convincing.
11. The benefits_of_correction must explain the value of correcting the finding.
12. Include recommended corrective/preventive actions.
13. Include expected evidence the auditor should review.
14. Be thorough, but do not invent requirements not supported by the PDF.
15. Risks, impacts and actions may be professional recommendations based on the extracted requirement, but the requirement itself must come from the PDF.
16. Always return questions with type = "yes_no".
17. Return structured JSON only through the function tool.
18. You MUST generate a non-empty "summary".
19. You MUST generate a non-empty "auditor_objective".
20. You MUST generate at least 5 items in "auditor_actions".
21. The suggested auditor actions must be concrete, for example: review documents, interview responsible people, inspect evidence, validate logs, verify approvals, check dates, confirm responsibilities or request missing records.
`;

    const userInstruction =
      "Extrae un cuestionario completo de auditoría de cumplimiento desde este PDF. Incluye obligatoriamente resumen del PDF, objetivo del auditor, acciones sugeridas para el auditor, referencias normativas, riesgos por hallazgos, impacto del incumplimiento, argumento para sustentar el hallazgo, beneficios de corregir, acciones recomendadas y evidencias esperadas por cada pregunta.";

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
      questions: (sec.questions ?? []).map((q: any, qi: number) => {
        const label = String(q.label ?? `Question ${qi + 1}`).trim();

        return {
          id: `q${si}_${qi}_${crypto.randomUUID().slice(0, 8)}`,
          label,
          type: "yes_no",
          required: q.required ?? true,
          options: [],
          scale_max: 5,
          reference: cleanObject(q.reference),
          risk: normalizeRisk(label, q.risk),
          recommended_actions:
            asArray(q.recommended_actions).length > 0
              ? asArray(q.recommended_actions)
              : buildFallbackRecommendedActions(label),
          expected_evidence:
            asArray(q.expected_evidence).length > 0
              ? asArray(q.expected_evidence)
              : buildFallbackExpectedEvidence(),
        };
      }),
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

    if (upErr) {
      throw upErr;
    }

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
        has_risks: sections.some((section: any) =>
          section.questions?.some((question: any) => Boolean(question.risk))
        ),
        has_impacts: sections.some((section: any) =>
          section.questions?.some(
            (question: any) =>
              Boolean(question.risk?.impact) ||
              Boolean(question.risk?.business_impact)
          )
        ),
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
