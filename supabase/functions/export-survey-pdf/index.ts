// Build a completed-survey PDF report based on the original uploaded PDF.
// - Auth required (JWT verified by gateway).
// - Members can export their own submitted response.
// - The survey owner (lead_auditor) and admins can export any member's response,
//   or a combined report (all submitted members) when userId is omitted.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function safe(s: unknown) {
  // Replace characters StandardFont WinAnsi can't encode.
  return String(s ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x00-\xFF]/g, "?");
}

function wrap(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = safe(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { surveyId, userId } = await req.json();
    if (!surveyId) throw new Error("surveyId required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const callerId = userRes?.user?.id;
    if (!callerId) throw new Error("Unauthorized");

    const { data: survey, error: sErr } = await admin
      .from("surveys")
      .select("id, title, description, pdf_path, schema, mode, lead_auditor_id, assigned_group_id, status")
      .eq("id", surveyId)
      .single();
    if (sErr || !survey) throw new Error("Survey not found");

    const isOwner = survey.lead_auditor_id === callerId;
    let isAdmin = false;
    {
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId)
        .eq("role", "admin")
        .maybeSingle();
      isAdmin = !!roleRow;
    }

    // Decide which responses to include
    let targetUserIds: string[] = [];
    if (userId) {
      // Specific member: caller must be that user, owner, or admin
      if (userId !== callerId && !isOwner && !isAdmin) throw new Error("Forbidden");
      targetUserIds = [userId];
    } else {
      // Combined report (all submitted members) — only owner/admin
      if (!isOwner && !isAdmin) throw new Error("Forbidden");
    }

    let respQuery = admin
      .from("survey_responses")
      .select("user_id, answers, submitted, submitted_at, progress")
      .eq("survey_id", surveyId)
      .eq("submitted", true);
    if (targetUserIds.length) respQuery = respQuery.in("user_id", targetUserIds);
    const { data: responses, error: rErr } = await respQuery;
    if (rErr) throw rErr;
    if (!responses || responses.length === 0) throw new Error("No submitted responses to export");

    // Profiles for member display
    const ids = Array.from(new Set(responses.map((r) => r.user_id)));
    const { data: profiles } = await admin
      .from("profiles")
      .select("id,email,full_name")
      .in("id", ids);
    const profMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    // Build PDF: optional original pages + appended answer pages per member
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);
    const fontBold = await out.embedFont(StandardFonts.HelveticaBold);

    // Copy original PDF first if present
    if (survey.pdf_path) {
      try {
        const { data: blob } = await admin.storage.from("survey-pdfs").download(survey.pdf_path);
        if (blob) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const copied = await out.copyPages(src, src.getPageIndices());
          copied.forEach((p) => out.addPage(p));
        }
      } catch (e) {
        console.warn("Could not embed original PDF", e);
      }
    }

    const sections = ((survey.schema as any)?.sections ?? []) as Array<{ id: string; title: string; questions: Array<any> }>;
    const isCompliance = (survey as any).mode === "compliance";

    // Helper: signed URL builder for evidence
    const signedUrl = async (path: string) => {
      try {
        const { data } = await admin.storage.from("response-files").createSignedUrl(path, 60 * 60 * 24 * 7);
        return data?.signedUrl ?? null;
      } catch { return null; }
    };

    // Build answer pages per member
    for (const resp of responses) {
      const profile = profMap.get(resp.user_id);
      const memberName = profile?.full_name || profile?.email || resp.user_id;

      let page = out.addPage([612, 792]); // US Letter
      const margin = 48;
      let y = 792 - margin;

      const drawTitle = (text: string, size = 16) => {
        page.drawText(safe(text), { x: margin, y, size, font: fontBold, color: rgb(0.1, 0.1, 0.15) });
        y -= size + 8;
      };
      const drawText = (text: string, size = 11, bold = false, color = rgb(0.15, 0.15, 0.18)) => {
        const f = bold ? fontBold : font;
        const lines = wrap(text, f, size, 612 - margin * 2);
        for (const line of lines) {
          if (y < margin + 40) { page = out.addPage([612, 792]); y = 792 - margin; }
          page.drawText(line, { x: margin, y, size, font: f, color });
          y -= size + 4;
        }
      };
      const hr = () => {
        if (y < margin + 20) { page = out.addPage([612, 792]); y = 792 - margin; }
        page.drawLine({ start: { x: margin, y }, end: { x: 612 - margin, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.9) });
        y -= 10;
      };

      drawTitle(`Audit report — ${survey.title}`, 18);
      drawText(`Mode: ${isCompliance ? "Compliance" : "Free"}`, 10);
      drawText(`Member: ${memberName}`, 10);
      drawText(`Submitted: ${resp.submitted_at ? new Date(resp.submitted_at).toLocaleString() : "-"}`, 10);
      hr();

      const answers = (resp.answers as any) ?? {};
      let qNum = 0;
      for (const sec of sections) {
        if (y < margin + 60) { page = out.addPage([612, 792]); y = 792 - margin; }
        y -= 6;
        drawText(sec.title, 13, true, rgb(0.05, 0.05, 0.1));
        for (const q of sec.questions) {
          qNum += 1;
          if (y < margin + 80) { page = out.addPage([612, 792]); y = 792 - margin; }
          drawText(`${qNum}. ${q.label}`, 11, true);
          const a = answers[q.id];
          if (isCompliance) {
            const v = (a && typeof a === "object" ? a : {}) as { value?: string; comment?: string; evidence?: { path: string; name: string } };
            const valLabel = v.value ?? "(no answer)";
            const valColor = v.value === "Yes" ? rgb(0.1, 0.55, 0.25) : v.value === "No" ? rgb(0.75, 0.15, 0.15) : rgb(0.4, 0.4, 0.45);
            drawText(`Answer: ${valLabel}`, 11, false, valColor);
            if (v.comment) drawText(`Comment: ${v.comment}`, 10);
            if (v.evidence?.path) {
              const url = await signedUrl(v.evidence.path);
              drawText(`Evidence: ${v.evidence.name}${url ? `  (${url})` : ""}`, 9, false, rgb(0.3, 0.3, 0.6));
            }
          } else {
            let txt = "(no answer)";
            if (a !== undefined && a !== null && a !== "") {
              if (typeof a === "object" && a.name) txt = `File: ${a.name}`;
              else if (Array.isArray(a)) txt = a.join(", ");
              else txt = String(a);
            }
            drawText(txt, 11);
          }
          y -= 4;
        }
      }
    }

    const bytes = await out.save();

    const exportPath = `${callerId}/exports/${surveyId}-${Date.now()}.pdf`;
    const { error: upErr } = await admin.storage
      .from("response-files")
      .upload(exportPath, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw upErr;

    const { data: signed } = await admin.storage
      .from("response-files")
      .createSignedUrl(exportPath, 60 * 60);

    return new Response(JSON.stringify({ success: true, url: signed?.signedUrl ?? null, path: exportPath }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("export-survey-pdf error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});