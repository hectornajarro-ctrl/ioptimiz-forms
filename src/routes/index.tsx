import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, FileText, Users, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "AuditFlow — Audit management platform" },
      {
        name: "description",
        content: "Convert PDF audits into digital forms, assign to teams, and track member progress in real time.",
      },
    ],
  }),
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-md bg-primary flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight">AuditFlow</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="ghost">Sign in</Button>
            </Link>
            <Link to="/login" search={{ mode: "signup" }}>
              <Button>Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <section
        className="border-b border-border"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="max-w-6xl mx-auto px-6 py-24 text-center">
          <span className="inline-block text-xs uppercase tracking-widest text-primary-foreground/70 mb-4">
            Audit management, simplified
          </span>
          <h1 className="text-5xl md:text-6xl font-semibold tracking-tight text-primary-foreground max-w-3xl mx-auto leading-tight">
            Turn PDF audit surveys into structured digital workflows.
          </h1>
          <p className="mt-6 text-lg text-primary-foreground/80 max-w-2xl mx-auto">
            Lead auditors upload surveys, AI converts them into editable forms, and your team
            completes them in parallel — with full visibility into progress.
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <Link to="/login" search={{ mode: "signup" }}>
              <Button size="lg" variant="secondary">
                Create an account
              </Button>
            </Link>
            <Link to="/login">
              <Button
                size="lg"
                variant="outline"
                className="bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: FileText,
              title: "AI form extraction",
              desc: "Upload any PDF survey. Our AI parses sections, questions and field types into an editable draft.",
            },
            {
              icon: Users,
              title: "Audit groups",
              desc: "Organize a Lead Auditor and Member Auditors into groups, then assign approved surveys with one click.",
            },
            {
              icon: BarChart3,
              title: "Live progress",
              desc: "Lead Auditors see exactly which members have completed which questions — in real time.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-lg border border-border bg-card p-6"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="h-10 w-10 rounded-md bg-secondary flex items-center justify-center mb-4">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold tracking-tight">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
