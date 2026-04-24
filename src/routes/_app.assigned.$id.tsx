import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Upload, CheckCircle2 } from "lucide-react";

type FieldType = "text" | "textarea" | "yes_no" | "multiple_choice" | "rating" | "file";

interface Question {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  scale_max: number;
}
interface Section { id: string; title: string; questions: Question[] }

export const Route = createFileRoute("/_app/assigned/$id")({
  component: FillSurvey,
  head: () => ({ meta: [{ title: "Fill audit — AuditFlow" }] }),
});

function FillSurvey() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [survey, setSurvey] = useState<{ title: string; description: string | null; sections: Section[] } | null>(null);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const allQuestions = useMemo(() => survey?.sections.flatMap((s) => s.questions) ?? [], [survey]);

  const progress = useMemo(() => {
    if (allQuestions.length === 0) return 0;
    const filled = allQuestions.filter((q) => {
      const v = answers[q.id];
      return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
    }).length;
    return Math.round((filled / allQuestions.length) * 100);
  }, [allQuestions, answers]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: s } = await supabase
        .from("surveys")
        .select("title,description,schema")
        .eq("id", id).single();
      if (!s) return;
      const sch = (s.schema as any) ?? { sections: [] };
      setSurvey({ title: s.title, description: s.description, sections: sch.sections ?? [] });

      const { data: existing } = await supabase
        .from("survey_responses")
        .select("id,answers,submitted")
        .eq("survey_id", id).eq("user_id", user.id).maybeSingle();
      if (existing) {
        setResponseId(existing.id);
        setAnswers((existing.answers as any) ?? {});
        setSubmitted(existing.submitted);
      } else {
        const { data: created, error } = await supabase
          .from("survey_responses")
          .insert({ survey_id: id, user_id: user.id, answers: {}, progress: 0 })
          .select("id").single();
        if (error) { toast.error(error.message); return; }
        setResponseId(created.id);
      }
    })();
  }, [id, user]);

  const updateAnswer = (qid: string, v: any) => setAnswers({ ...answers, [qid]: v });

  const onUploadFile = async (qid: string, file: File) => {
    if (!user) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("File too large (max 10 MB)");
    const path = `${user.id}/${id}/${qid}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("response-files").upload(path, file, { upsert: false });
    if (error) return toast.error(error.message);
    updateAnswer(qid, { path, name: file.name });
    toast.success("File attached");
  };

  const persist = async (opts: { submit?: boolean } = {}) => {
    if (!responseId) return;
    setSaving(true);
    const payload: any = { answers, progress };
    if (opts.submit) {
      // Validate required
      const missing = allQuestions.filter((q) => q.required && (answers[q.id] === undefined || answers[q.id] === "" || answers[q.id] === null));
      if (missing.length) {
        setSaving(false);
        return toast.error(`${missing.length} required question(s) missing`);
      }
      payload.submitted = true;
      payload.submitted_at = new Date().toISOString();
      payload.progress = 100;
    }
    const { error } = await supabase.from("survey_responses").update(payload).eq("id", responseId);
    setSaving(false);
    if (error) return toast.error(error.message);
    if (opts.submit) {
      setSubmitted(true);
      toast.success("Submitted ✓");
    } else {
      toast.success("Saved");
    }
  };

  if (!survey) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Link to="/assigned" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to assigned audits
      </Link>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{survey.title}</h1>
        {survey.description && <p className="text-muted-foreground mt-1">{survey.description}</p>}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${submitted ? 100 : progress}%` }} />
          </div>
          <span className="text-xs text-muted-foreground">
            {submitted ? "Submitted" : `${progress}% complete`}
          </span>
        </div>
      </div>

      {submitted && (
        <div className="mb-6 rounded-md bg-success/10 text-success p-4 flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4" /> You've submitted this audit. Answers below are read-only.
        </div>
      )}

      <div className="space-y-5">
        {survey.sections.map((sec) => (
          <div key={sec.id} className="rounded-lg border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <h2 className="font-semibold tracking-tight mb-4">{sec.title}</h2>
            <div className="space-y-5">
              {sec.questions.map((q, i) => (
                <div key={q.id}>
                  <Label className="mb-2 block">
                    <span className="text-muted-foreground mr-1">{i + 1}.</span>
                    {q.label}
                    {q.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  {q.type === "text" && (
                    <Input value={answers[q.id] ?? ""} onChange={(e) => updateAnswer(q.id, e.target.value)} disabled={submitted} maxLength={500} />
                  )}
                  {q.type === "textarea" && (
                    <Textarea value={answers[q.id] ?? ""} onChange={(e) => updateAnswer(q.id, e.target.value)} disabled={submitted} maxLength={5000} rows={4} />
                  )}
                  {q.type === "yes_no" && (
                    <div className="flex gap-2">
                      {["Yes", "No", "N/A"].map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          disabled={submitted}
                          onClick={() => updateAnswer(q.id, opt)}
                          className={`px-4 py-2 rounded-md border text-sm transition-colors ${answers[q.id] === opt ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent hover:text-accent-foreground"}`}
                        >{opt}</button>
                      ))}
                    </div>
                  )}
                  {q.type === "multiple_choice" && (
                    <div className="space-y-1.5">
                      {q.options.map((opt) => (
                        <label key={opt} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={q.id}
                            value={opt}
                            checked={answers[q.id] === opt}
                            onChange={() => updateAnswer(q.id, opt)}
                            disabled={submitted}
                          />
                          <span className="text-sm">{opt}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {q.type === "rating" && (
                    <div className="flex gap-1">
                      {Array.from({ length: q.scale_max }).map((_, n) => {
                        const v = n + 1;
                        return (
                          <button
                            key={v}
                            type="button"
                            disabled={submitted}
                            onClick={() => updateAnswer(q.id, v)}
                            className={`w-10 h-10 rounded-md border text-sm font-medium transition-colors ${answers[q.id] === v ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent hover:text-accent-foreground"}`}
                          >{v}</button>
                        );
                      })}
                    </div>
                  )}
                  {q.type === "file" && (
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer">
                        <input type="file" className="hidden" disabled={submitted} onChange={(e) => e.target.files?.[0] && onUploadFile(q.id, e.target.files[0])} />
                        <span className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                          <Upload className="h-4 w-4" /> {answers[q.id]?.name ? "Replace file" : "Upload file"}
                        </span>
                      </label>
                      {answers[q.id]?.name && <span className="text-xs text-muted-foreground">{answers[q.id].name}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!submitted && (
        <div className="mt-6 flex items-center gap-3">
          <Button variant="outline" onClick={() => persist()} disabled={saving}>
            {saving ? "Saving…" : "Save progress"}
          </Button>
          <Button onClick={() => persist({ submit: true })} disabled={saving}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> Submit audit
          </Button>
        </div>
      )}
    </div>
  );
}