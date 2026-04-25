import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus, FileText, Clock, CheckCircle2 } from "lucide-react";

interface SurveyRow {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "approved" | "archived";
  created_at: string;
  assigned_group_id: string | null;
}

export const Route = createFileRoute("/_app/surveys")({
  component: Surveys,
  head: () => ({ meta: [{ title: "Surveys — AuditFlow" }] }),
});

function Surveys() {
  const { user, hasRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SurveyRow[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !hasRole("lead_auditor") && !hasRole("admin")) {
      navigate({ to: "/dashboard" });
    }
  }, [authLoading, hasRole, navigate]);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("surveys")
      .select("id,title,description,status,created_at,assigned_group_id")
      .eq("lead_auditor_id", user.id)
      .order("created_at", { ascending: false });
    setRows((data ?? []) as SurveyRow[]);
  };

  useEffect(() => { if (user) load(); }, [user]);

  const createSurvey = async () => {
    if (!user) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("surveys")
      .insert({ title: "Untitled survey", lead_auditor_id: user.id })
      .select("id").single();
    setCreating(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/surveys/$id", params: { id: data.id } });
  };

  const statusBadge = (s: SurveyRow["status"]) => {
    const map: Record<string, { bg: string; text: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
      draft: { bg: "bg-warning/15", text: "text-warning-foreground", label: "Draft", icon: Clock },
      approved: { bg: "bg-success/15", text: "text-success", label: "Approved", icon: CheckCircle2 },
      archived: { bg: "bg-muted", text: "text-muted-foreground", label: "Archived", icon: FileText },
    };
    const v = map[s];
    const Icon = v.icon;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${v.bg} ${v.text}`}>
        <Icon className="h-3 w-3" /> {v.label}
      </span>
    );
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">My Surveys</h1>
          <p className="text-muted-foreground mt-1">Create surveys, upload PDFs, and assign approved forms to groups.</p>
        </div>
        <Button onClick={createSurvey} disabled={creating}>
          <Plus className="h-4 w-4 mr-2" /> New survey
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
          No surveys yet. Click <strong>New survey</strong> to start.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((s) => (
            <Link key={s.id} to="/surveys/$id" params={{ id: s.id }}>
              <div className="rounded-lg border border-border bg-card p-5 h-full transition-colors hover:border-accent" style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="flex items-start justify-between mb-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  {statusBadge(s.status)}
                </div>
                <div className="font-semibold tracking-tight">{s.title}</div>
                {s.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{s.description}</p>}
                <div className="text-xs text-muted-foreground mt-4">
                  {new Date(s.created_at).toLocaleDateString()}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}