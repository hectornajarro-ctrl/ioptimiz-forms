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
      "Convert an audit, checklist, regulation, policy or standard PDF into a structured compliance audit form schema with sections, questions, normative references, risks, recommended actions and expected evidence.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the survey/audit",
        },
        description: {
          type: "string",
          description: "One-sentence description of the audit",
        },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Audit section title",
              },
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description:
                        "The audit question. Phrase it so Yes means compliant and No means non-compliant.",
                    },
                    type: {
                      type: "string",
                      enum: ["yes_no"],
                      description:
                        "Always use yes_no for compliance audits.",
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
                            "Short summary of the requirement that must be verified.",
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
                          description: "Short risk title",
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
                  required: ["label", "type"],
                },
              },
            },
            required: ["title", "questions"],
          },
        },
      },
      required: ["title", "sections"],
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
`;

    const userInstruction =
      "Extract a complete compliance audit questionnaire from this PDF. Include normative references, risks for findings, recommended actions and expected evidence for every question.";

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
      title: sec.title ?? `Section ${si + 1}`,
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

    const update: any = {
      mode: "compliance",
      schema: {
        sections,
      },
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
