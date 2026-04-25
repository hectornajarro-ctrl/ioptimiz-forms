// Extract structured form schema from a PDF using Lovable AI
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
    description: "Convert the audit PDF into a structured form schema with sections and questions.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the survey/audit" },
        description: { type: "string", description: "One-sentence description" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "The question text" },
                    type: {
                      type: "string",
                      enum: ["text", "textarea", "yes_no", "multiple_choice", "rating", "file"],
                    },
                    required: { type: "boolean" },
                    options: {
                      type: "array",
                      items: { type: "string" },
                      description: "Choices for multiple_choice; ignored for other types",
                    },
                    scale_max: {
                      type: "number",
                      description: "For rating: max scale (e.g. 5 or 10). Default 5.",
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { surveyId } = await req.json();
    if (!surveyId) throw new Error("surveyId required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Auth check — must be the survey owner
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) throw new Error("Unauthorized");

    const { data: survey, error: sErr } = await admin
      .from("surveys")
      .select("id, pdf_path, title, lead_auditor_id")
      .eq("id", surveyId)
      .single();
    if (sErr || !survey) throw new Error("Survey not found");
    // Allow if owner OR admin
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

    // Download PDF
    const { data: blob, error: dlErr } = await admin.storage.from("survey-pdfs").download(survey.pdf_path);
    if (dlErr || !blob) throw new Error("Could not download PDF");
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const b64 = btoa(binary);

    // Call Lovable AI Gateway with PDF as inline data + tool calling for structured output
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            content:
              "You are an expert at converting audit checklists and survey PDFs into structured digital forms. Identify sections, questions, and the most appropriate field type for each question. Use 'yes_no' for compliance/Y-N items, 'rating' for scored items, 'multiple_choice' when options are listed, 'file' if evidence/photos are requested, 'textarea' for long-form notes, and 'text' for short answers. Be thorough but do not invent questions that aren't in the document.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract a complete form schema from this audit PDF." },
              {
                type: "file",
                file: { filename: "survey.pdf", file_data: `data:application/pdf;base64,${b64}` },
              },
            ],
          },
        ],
        tools: [FORM_SCHEMA_TOOL],
        tool_choice: { type: "function", function: { name: "build_form_schema" } },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("AI gateway error", aiRes.status, t);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached. Please try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in workspace settings." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw new Error("AI extraction failed");
    }

    const aiJson = await aiRes.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("AI did not return a structured response");
    const args = JSON.parse(toolCall.function.arguments);

    // Add ids to each question for stable references
    const sections = (args.sections ?? []).map((sec: any, si: number) => ({
      id: `s${si}_${crypto.randomUUID().slice(0, 8)}`,
      title: sec.title ?? `Section ${si + 1}`,
      questions: (sec.questions ?? []).map((q: any, qi: number) => ({
        id: `q${si}_${qi}_${crypto.randomUUID().slice(0, 8)}`,
        label: q.label,
        type: q.type,
        required: !!q.required,
        options: q.options ?? [],
        scale_max: q.scale_max ?? 5,
      })),
    }));

    const update: any = { schema: { sections } };
    if (args.title && (!survey.title || survey.title === "Untitled survey")) update.title = args.title;
    if (args.description) update.description = args.description;

    const { error: upErr } = await admin.from("surveys").update(update).eq("id", surveyId);
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ success: true, sections: sections.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-survey error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});