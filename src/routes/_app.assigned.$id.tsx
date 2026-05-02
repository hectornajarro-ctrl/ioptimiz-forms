import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, CheckCircle2, Camera, Download } from "lucide-react";

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
  severity?: string;
  likelihood?: string;
  impact?: string;
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

interface ComplianceAnswer {
  value?: string;
  comment?: string;
  evidence?: {
    path: string;
    name: string;
  };
}

export const Route = createFileRoute("/_app/assigned/$id")({
  component: FillSurvey,
  head: () => ({
    meta: [{ title: "Fill audit — AuditFlow" }],
  }),
});

function hasReference(q: Question) {
  return Boolean(
    q.reference?.source_title ||
      q.reference?.section ||
      q.reference?.page ||
      q.reference?.requirement ||
      q.reference?.source_text ||
      (q.expected_evidence?.length ?? 0) > 0
  );
}

function hasRisk(q: Question) {
  return Boolean(
    q.risk?.title ||
      q.risk?.description ||
      q.risk?.category ||
      q.risk?.severity ||
      q.risk?.likelihood ||
      q.risk?.impact ||
      (q.recommended_actions?.length ?? 0) > 0
  );
}

function FillSurvey() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [survey, setSurvey] = useState<{
    title: string;
    description: string | null;
    sections: Section[];
    mode: "compliance";
    pdf_path: string | null;
    starts_at: string | null;
    ends_at: string | null;
  } | null>(null);

  const [responseId, setResponseId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const allQuestions = useMemo(
    () => survey?.sections.flatMap((s) => s.questions) ?? [],
    [survey]
  );

  const progress = useMemo(() => {
    if (allQuestions.length === 0) return 0;

    const filled = allQuestions.filter((q) => {
      const v = answers[q.id];

      return (
        v &&
        typeof v === "object" &&
        v.value !== undefined &&
        v.value !== null &&
        v.value !== ""
      );
    }).length;

    return Math.round((filled / allQuestions.length) * 100);
  }, [allQuestions, answers]);

  useEffect(() => {
    if (!user) return;

    (async () => {
      const { data: s } = await supabase
        .from("surveys")
        .select(
          "title,description,schema,mode,pdf_path,assigned_group_id,starts_at,ends_at"
        )
        .eq("id", id)
        .single();

      if (!s) return;

      const sch = (s.schema as any) ?? { sections: [] };

      setSurvey({
        title: s.title,
        description: s.description,
        sections: sch.sections ?? [],
        mode: "compliance",
        pdf_path: (s as any).pdf_path ?? null,
        starts_at: (s as any).starts_at ?? null,
        ends_at: (s as any).ends_at ?? null,
      });

      const now = Date.now();
      const startsAt = (s as any).starts_at as string | null;
      const endsAt = (s as any).ends_at as string | null;

      const notYetOpen = !!startsAt && new Date(startsAt).getTime() > now;
      const closed = !!endsAt && new Date(endsAt).getTime() < now;

      const { data: existing } = await supabase
        .from("survey_responses")
        .select("id,answers,submitted")
        .eq("survey_id", id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        setResponseId(existing.id);
        setAnswers((existing.answers as any) ?? {});
        setSubmitted(existing.submitted);

        if (closed && !existing.submitted) {
          toast.error(
            "This audit has closed. You can no longer submit answers."
          );
        }

        return;
      }

      if (notYetOpen) {
        toast.error(`This audit opens on ${new Date(startsAt!).toLocaleString()}`);
        navigate({ to: "/assigned" });
        return;
      }

      if (closed) {
        toast.error("This audit has closed.");
        navigate({ to: "/assigned" });
        return;
      }

      const groupId = (s as any).assigned_group_id as string | null;

      if (groupId) {
        const { data: grp } = await supabase
          .from("audit_groups")
          .select("open_enrollment")
          .eq("id", groupId)
          .maybeSingle();

        const { data: existingMembers } = await supabase
          .from("audit_group_members")
          .select("user_id")
          .eq("group_id", groupId);

        const isMember = !!existingMembers?.some(
          (m) => m.user_id === user.id
        );

        const isUnclaimed = (existingMembers?.length ?? 0) === 0;

        if (!isMember && grp?.open_enrollment && isUnclaimed) {
          const { error: claimErr } = await supabase
            .from("audit_group_members")
            .insert({
              group_id: groupId,
              user_id: user.id,
            });

          if (claimErr) {
            toast.error("Someone else just claimed this audit");
            navigate({ to: "/assigned" });
            return;
          }

          toast.success("You claimed this audit");
        } else if (!isMember && grp?.open_enrollment && !isUnclaimed) {
          toast.error("This audit has already been claimed by another member");
          navigate({ to: "/assigned" });
          return;
        }
      }

      const { data: created, error } = await supabase
        .from("survey_responses")
        .insert({
          survey_id: id,
          user_id: user.id,
          answers: {},
          progress: 0,
        })
        .select("id")
        .single();

      if (error) {
        toast.error(error.message);
        return;
      }

      setResponseId(created.id);
    })();
  }, [id, user, navigate]);

  const getCompVal = (qid: string) =>
    (answers[qid] ?? {}) as ComplianceAnswer;

  const setCompField = (qid: string, patch: Partial<ComplianceAnswer>) => {
    const cur = getCompVal(qid);

    setAnswers({
      ...answers,
      [qid]: {
        ...cur,
        ...patch,
      },
    });
  };

  const onUploadFile = async (qid: string, file: File) => {
    if (!user) return;

    if (file.size > 10 * 1024 * 1024) {
      return toast.error("File too large (max 10 MB)");
    }

    const path = `${user.id}/${id}/${qid}-${Date.now()}-${file.name}`;

    const { error } = await supabase.storage
      .from("response-files")
      .upload(path, file, {
        upsert: false,
      });

    if (error) return toast.error(error.message);

    setCompField(qid, {
      evidence: {
        path,
        name: file.name,
      },
    });

    toast.success("File attached");
  };

  const persist = async (opts: { submit?: boolean } = {}) => {
    if (!responseId) return;

    if (
      survey?.ends_at &&
      new Date(survey.ends_at).getTime() < Date.now() &&
      !submitted
    ) {
      return toast.error("This audit has closed and can no longer be modified.");
    }

    setSaving(true);

    const payload: any = {
      answers,
      progress,
    };

    if (opts.submit) {
      const missing = allQuestions.filter((q) => {
        if (!q.required) return false;

        const v = answers[q.id];

        return !v || typeof v !== "object" || !v.value;
      });

      if (missing.length) {
        setSaving(false);
        return toast.error(`${missing.length} required question(s) missing`);
      }

      payload.submitted = true;
      payload.submitted_at = new Date().toISOString();
      payload.progress = 100;
    }

    const { error } = await supabase
      .from("survey_responses")
      .update(payload)
      .eq("id", responseId);

    setSaving(false);

    if (error) return toast.error(error.message);

    if (opts.submit) {
      setSubmitted(true);
      toast.success("Submitted ✓");
    } else {
      toast.success("Saved");
    }
  };

  const exportReport = async () => {
    setExporting(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "export-survey-pdf",
        {
          body: {
            surveyId: id,
            userId: user?.id,
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        toast.error("Export failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (!survey) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="container mx-auto max-w-5xl py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/assigned">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to assigned audits
          </Link>
        </Button>

        <div className="ml-auto text-sm text-muted-foreground">
          {submitted ? "Submitted" : `${progress}% complete`}
        </div>
      </div>

      <div
        className="rounded-lg border bg-card p-6 mb-6"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <h1 className="text-2xl font-semibold tracking-tight">
          {survey.title}
        </h1>

        {survey.description && (
          <p className="text-muted-foreground mt-2">{survey.description}</p>
        )}

        {submitted && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="text-muted-foreground">
              You've submitted this audit. Answers below are read-only.
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={exportReport}
              disabled={exporting}
              className="ml-auto"
            >
              <Download className="h-4 w-4 mr-1" />
              {exporting ? "Generating…" : "Export report (PDF)"}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-6">
        {survey.sections.map((sec) => (
          <div
            key={sec.id}
            className="rounded-lg border bg-card p-6"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <h2 className="text-lg font-semibold tracking-tight mb-4">
              {sec.title}
            </h2>

            <div className="space-y-5">
              {sec.questions.map((q, i) => (
                <div key={q.id} className="rounded-md border bg-background p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-xs text-muted-foreground mt-1 w-6 shrink-0">
                      {i + 1}.
                    </span>

                    <div className="flex-1 space-y-3">
                      <div>
                        <Label className="text-base">
                          {q.label}
                          {q.required && (
                            <span className="text-destructive ml-1">*</span>
                          )}
                        </Label>
                      </div>

                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {[
                            {
                              v: "Yes",
                              cls: "data-[on=true]:bg-success data-[on=true]:text-white data-[on=true]:border-success",
                            },
                            {
                              v: "No",
                              cls: "data-[on=true]:bg-destructive data-[on=true]:text-destructive-foreground data-[on=true]:border-destructive",
                            },
                            {
                              v: "N/A",
                              cls: "data-[on=true]:bg-muted data-[on=true]:text-foreground data-[on=true]:border-muted-foreground/40",
                            },
                          ].map(({ v, cls }) => {
                            const on = getCompVal(q.id).value === v;

                            return (
                              <button
                                key={v}
                                type="button"
                                data-on={on}
                                disabled={submitted}
                                onClick={() => setCompField(q.id, { value: v })}
                                className={`px-4 py-2 rounded-md border text-sm transition-colors bg-background hover:bg-accent hover:text-accent-foreground ${cls}`}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>

                        {hasReference(q) && (
                          <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-2">
                            <div className="font-medium">
                              Normative reference
                            </div>

                            {(q.reference?.source_title ||
                              q.reference?.section ||
                              q.reference?.page) && (
                              <div className="text-muted-foreground">
                                {[
                                  q.reference?.source_title,
                                  q.reference?.section,
                                  q.reference?.page &&
                                    `Page ${q.reference.page}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            )}

                            {q.reference?.requirement && (
                              <div>
                                <span className="font-medium">
                                  Requirement:{" "}
                                </span>
                                {q.reference.requirement}
                              </div>
                            )}

                            {q.reference?.source_text && (
                              <div className="text-xs text-muted-foreground">
                                {q.reference.source_text}
                              </div>
                            )}

                            {(q.expected_evidence?.length ?? 0) > 0 && (
                              <div>
                                <div className="font-medium">
                                  Expected evidence:
                                </div>
                                <ul className="list-disc pl-5 text-muted-foreground">
                                  {q.expected_evidence!.map((item, idx) => (
                                    <li key={idx}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        {getCompVal(q.id).value === "No" && hasRisk(q) && (
                          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-2">
                            <div className="font-semibold text-destructive">
                              Finding risk:{" "}
                              {q.risk?.title ||
                                "Potential non-compliance risk"}
                            </div>

                            <div className="flex flex-wrap gap-2 text-xs">
                              {q.risk?.category && (
                                <span className="rounded-full border px-2 py-0.5">
                                  {q.risk.category}
                                </span>
                              )}

                              {q.risk?.severity && (
                                <span className="rounded-full border px-2 py-0.5">
                                  Severity: {q.risk.severity}
                                </span>
                              )}

                              {q.risk?.likelihood && (
                                <span className="rounded-full border px-2 py-0.5">
                                  Likelihood: {q.risk.likelihood}
                                </span>
                              )}

                              {q.risk?.impact && (
                                <span className="rounded-full border px-2 py-0.5">
                                  Impact: {q.risk.impact}
                                </span>
                              )}
                            </div>

                            {q.risk?.description && (
                              <p className="text-muted-foreground">
                                {q.risk.description}
                              </p>
                            )}

                            {(q.recommended_actions?.length ?? 0) > 0 && (
                              <div>
                                <div className="font-medium">
                                  Recommended actions:
                                </div>
                                <ul className="list-disc pl-5 text-muted-foreground">
                                  {q.recommended_actions!.map((item, idx) => (
                                    <li key={idx}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        <Textarea
                          placeholder="Comment / finding details"
                          value={getCompVal(q.id).comment ?? ""}
                          onChange={(e) =>
                            setCompField(q.id, {
                              comment: e.target.value,
                            })
                          }
                          disabled={submitted}
                          maxLength={2000}
                          rows={2}
                        />

                        <div className="flex items-center gap-3">
                          <label className="cursor-pointer">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={submitted}
                              onChange={(e) =>
                                e.target.files?.[0] &&
                                onUploadFile(q.id, e.target.files[0])
                              }
                            />

                            <span className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                              <Camera className="h-4 w-4" />
                              {getCompVal(q.id).evidence?.name
                                ? "Replace photo evidence"
                                : "Add photo evidence"}
                            </span>
                          </label>

                          {getCompVal(q.id).evidence?.name && (
                            <span className="text-xs text-muted-foreground truncate max-w-xs">
                              {getCompVal(q.id).evidence!.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!submitted && (
        <div className="mt-6 flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => persist()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save progress"}
          </Button>

          <Button onClick={() => persist({ submit: true })} disabled={saving}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Submit audit
          </Button>
        </div>
      )}
    </div>
  );
}
