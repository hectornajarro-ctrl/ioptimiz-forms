import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Upload, Sparkles, Plus, Trash2, ArrowLeft, BarChart3, CheckCircle2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type FieldType = "text" | "textarea" | "yes_no" | "multiple_choice" | "rating" | "file";

interface Question {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  scale_max: number;
}

interface Section {
  id: string;
  title: string;
  questions: Question[];
}

interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "approved" | "archived";
  mode: "free" | "compliance";
  pdf_path: string | null;
  schema: { sections: Section[] };
  assigned_group_id: string | null;
  lead_auditor_id: string;
}

const TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  yes_no: "Yes / No",
  multiple_choice: "Multiple choice",
  rating: "Rating scale",
  file: "File / Photo upload",
};

export const Route = createFileRoute("/_app/surveys/$id")({
  component: SurveyEditor,
  head: () => ({ meta: [{ title: "Survey editor — AuditFlow" }] }),
});

function uid() { return Math.random().toString(36).slice(2, 10); }

function SurveyEditor() {
  const { id } = Route.useParams();
  const { user, session, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [survey, setSurvey] = useState<SurveyRow | null>(null);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("surveys")
      .select("id,title,description,status,mode,pdf_path,schema,assigned_group_id,lead_auditor_id")
      .eq("id", id)
      .single();
    if (error) { toast.error(error.message); return; }
    const sch = (data.schema as any) ?? { sections: [] };
    setSurvey({ ...data, mode: (data as any).mode ?? "free", schema: { sections: sch.sections ?? [] } } as SurveyRow);

    // Admins can assign to ANY group; lead auditors can only assign to groups they lead
    const groupQuery = hasRole("admin")
      ? supabase.from("audit_groups").select("id,name").order("name")
      : supabase.from("audit_groups").select("id,name").eq("lead_auditor_id", data.lead_auditor_id).order("name");
    const { data: g } = await groupQuery;
    setGroups(g ?? []);
  };

  useEffect(() => { if (user) load(); }, [id, user]);

  if (location.pathname.endsWith("/progress")) {
    return <Outlet />;
  }

  if (!survey) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  // Admins can edit/manage any survey; lead auditors only their own
  const isOwner = user?.id === survey.lead_auditor_id || hasRole("admin");
  const isDraft = survey.status === "draft";

  const updateField = (patch: Partial<SurveyRow>) => setSurvey({ ...survey, ...patch });
  const updateSchema = (sections: Section[]) => setSurvey({ ...survey, schema: { sections } });

  const persist = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("surveys")
      .update({
        title: survey.title,
        description: survey.description,
        mode: survey.mode,
        schema: survey.schema as any,
        assigned_group_id: survey.assigned_group_id,
      })
      .eq("id", survey.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };

  const onUpload = async (file: File) => {
    if (!user) return;
    if (file.type !== "application/pdf") return toast.error("Please upload a PDF file");
    if (file.size > 15 * 1024 * 1024) return toast.error("File too large (max 15 MB)");
    setUploading(true);
    const path = `${user.id}/${survey.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("survey-pdfs").upload(path, file, { upsert: false, contentType: "application/pdf" });
    if (error) { setUploading(false); return toast.error(error.message); }
    await supabase.from("surveys").update({ pdf_path: path }).eq("id", survey.id);
    setUploading(false);
    toast.success("PDF uploaded");
    await load();
  };

  const runExtract = async () => {
    if (!survey.pdf_path) return toast.error("Upload a PDF first");
    if (!session) return;
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-survey", {
        body: { surveyId: survey.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Extracted ${data.sections} section(s)`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Extraction failed";
      toast.error(msg);
    } finally {
      setExtracting(false);
    }
  };

  const approve = async () => {
    if (!survey.assigned_group_id) return toast.error("Assign a group first");
    if (survey.schema.sections.length === 0) return toast.error("Add at least one question");
    await persist();
    const { error } = await supabase
      .from("surveys")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", survey.id);
    if (error) return toast.error(error.message);
    toast.success("Survey approved & assigned");
    await load();
  };

  const reopen = async () => {
    const { error } = await supabase.from("surveys").update({ status: "draft", approved_at: null }).eq("id", survey.id);
    if (error) return toast.error(error.message);
    toast.success("Survey reopened as draft");
    await load();
  };

  const deleteSurvey = async () => {
    const { error } = await supabase.from("surveys").delete().eq("id", survey.id);
    if (error) return toast.error(error.message);
    toast.success("Draft deleted");
    navigate({ to: "/surveys" });
  };

  // Schema editing helpers
  const addSection = () => updateSchema([...survey.schema.sections, { id: uid(), title: "New section", questions: [] }]);
  const removeSection = (sid: string) => updateSchema(survey.schema.sections.filter((s) => s.id !== sid));
  const editSection = (sid: string, patch: Partial<Section>) =>
    updateSchema(survey.schema.sections.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
  const addQuestion = (sid: string) => editSection(sid, {
    questions: [
      ...(survey.schema.sections.find((s) => s.id === sid)?.questions ?? []),
      { id: uid(), label: "New question", type: "text", required: false, options: [], scale_max: 5 },
    ],
  });
  const editQuestion = (sid: string, qid: string, patch: Partial<Question>) => {
    const sec = survey.schema.sections.find((s) => s.id === sid);
    if (!sec) return;
    editSection(sid, { questions: sec.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)) });
  };
  const removeQuestion = (sid: string, qid: string) => {
    const sec = survey.schema.sections.find((s) => s.id === sid);
    if (!sec) return;
    editSection(sid, { questions: sec.questions.filter((q) => q.id !== qid) });
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Link to="/surveys" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to surveys
        </Link>
        <div className="flex items-center gap-2">
          {survey.status === "approved" && (
            <Link to="/surveys/$id/progress" params={{ id: survey.id }}>
              <Button variant="outline"><BarChart3 className="h-4 w-4 mr-2" /> View progress</Button>
            </Link>
          )}
          {isDraft && isOwner && (
            <>
              <Button variant="outline" onClick={persist} disabled={saving}>{saving ? "Saving…" : "Save draft"}</Button>
              <Button onClick={approve}><CheckCircle2 className="h-4 w-4 mr-2" /> Approve & assign</Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                    <AlertDialogDescription>
                      "{survey.title}" will be permanently deleted. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteSurvey} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {!isDraft && isOwner && (
            <Button variant="outline" onClick={reopen}>Reopen as draft</Button>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="rounded-lg border bg-card p-6 mb-6" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={survey.title} onChange={(e) => updateField({ title: e.target.value })} disabled={!isDraft} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={survey.description ?? ""} onChange={(e) => updateField({ description: e.target.value })} disabled={!isDraft} maxLength={500} />
          </div>
          <div className="space-y-1.5">
            <Label>Assign to group</Label>
            <Select
              value={survey.assigned_group_id ?? ""}
              onValueChange={(v) => updateField({ assigned_group_id: v || null })}
              disabled={!isDraft}
            >
              <SelectTrigger><SelectValue placeholder={groups.length ? "Select a group" : "You don't lead any groups yet"} /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* PDF & AI */}
      {isDraft && (
        <div className="rounded-lg border bg-card p-6 mb-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <h2 className="font-semibold tracking-tight mb-1">Source PDF</h2>
          <p className="text-sm text-muted-foreground mb-4">Upload a PDF survey, then let AI extract the form structure.</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer">
              <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
              <span className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : survey.pdf_path ? "Replace PDF" : "Upload PDF"}
              </span>
            </label>
            {survey.pdf_path && (
              <span className="text-xs text-muted-foreground truncate max-w-xs">{survey.pdf_path.split("/").pop()}</span>
            )}
            <Button onClick={runExtract} disabled={!survey.pdf_path || extracting}>
              <Sparkles className="h-4 w-4 mr-2" /> {extracting ? "Extracting with AI…" : "Extract with AI"}
            </Button>
          </div>
        </div>
      )}

      {/* Sections / questions */}
      <div className="space-y-5">
        {survey.schema.sections.map((sec) => (
          <div key={sec.id} className="rounded-lg border bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="flex items-start gap-3 mb-4">
              <Input
                value={sec.title}
                onChange={(e) => editSection(sec.id, { title: e.target.value })}
                disabled={!isDraft}
                className="font-semibold text-base"
                maxLength={200}
              />
              {isDraft && (
                <Button variant="ghost" size="icon" onClick={() => removeSection(sec.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {sec.questions.map((q, idx) => (
                <div key={q.id} className="rounded-md border bg-background p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground mt-2 w-6 shrink-0">{idx + 1}.</span>
                    <div className="flex-1 grid gap-2">
                      <Input
                        value={q.label}
                        onChange={(e) => editQuestion(sec.id, q.id, { label: e.target.value })}
                        disabled={!isDraft}
                        placeholder="Question"
                        maxLength={500}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={q.type}
                          onValueChange={(v) => editQuestion(sec.id, q.id, { type: v as FieldType })}
                          disabled={!isDraft}
                        >
                          <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(TYPE_LABELS).map(([v, l]) => (
                              <SelectItem key={v} value={v}>{l}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <label className="text-xs flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={q.required}
                            disabled={!isDraft}
                            onChange={(e) => editQuestion(sec.id, q.id, { required: e.target.checked })}
                          />
                          Required
                        </label>
                        {q.type === "rating" && (
                          <div className="text-xs flex items-center gap-1.5">
                            Scale max:
                            <Input
                              type="number"
                              className="w-16 h-8"
                              value={q.scale_max}
                              min={2}
                              max={10}
                              disabled={!isDraft}
                              onChange={(e) => editQuestion(sec.id, q.id, { scale_max: Math.max(2, Math.min(10, Number(e.target.value) || 5)) })}
                            />
                          </div>
                        )}
                        {isDraft && (
                          <Button variant="ghost" size="icon" onClick={() => removeQuestion(sec.id, q.id)} className="ml-auto text-muted-foreground hover:text-destructive h-8 w-8">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {q.type === "multiple_choice" && (
                        <Input
                          value={q.options.join(", ")}
                          onChange={(e) => editQuestion(sec.id, q.id, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })}
                          disabled={!isDraft}
                          placeholder="Comma-separated options"
                          maxLength={500}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {isDraft && (
                <Button variant="outline" size="sm" onClick={() => addQuestion(sec.id)}>
                  <Plus className="h-4 w-4 mr-1" /> Add question
                </Button>
              )}
            </div>
          </div>
        ))}

        {isDraft && (
          <Button variant="outline" onClick={addSection} className="w-full">
            <Plus className="h-4 w-4 mr-2" /> Add section
          </Button>
        )}

        {survey.schema.sections.length === 0 && !isDraft && (
          <div className="text-center text-muted-foreground py-12">No questions in this survey.</div>
        )}
      </div>
    </div>
  );
}