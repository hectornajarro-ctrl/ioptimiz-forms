import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import {
  ShieldCheck,
  Users,
  FolderKanban,
  FileText,
  ClipboardList,
  LogOut,
  LayoutDashboard,
  History,
  ListTodo,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEffect, type ComponentType } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  show: boolean;
}

export function AppLayout() {
  const { user, roles, loading, hasRole, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
    }
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  const items: NavItem[] = [
    {
      to: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      show: true,
    },
    {
      to: "/admin/users",
      label: "Users",
      icon: Users,
      show: hasRole("admin"),
    },
    {
      to: "/admin/audits",
      label: "Audits",
      icon: FolderKanban,
      show: hasRole("admin") || hasRole("lead_auditor"),
    },
    {
      to: "/admin/activity",
      label: "Activity Log",
      icon: History,
      show: hasRole("admin"),
    },
    {
      to: "/surveys",
      label: "My Surveys",
      icon: FileText,
      show: hasRole("lead_auditor") || hasRole("admin"),
    },
    {
      to: "/action-plans",
      label: "Action Plans",
      icon: ListTodo,
      show: hasRole("lead_auditor") || hasRole("admin"),
    },
    {
      to: "/assigned",
      label: "Assigned Audits",
      icon: ClipboardList,
      show: hasRole("member_auditor"),
    },
  ];

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-[308px] shrink-0 flex-col bg-[#061B33] text-white">
        <div className="border-b border-white/10 px-7 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-cyan-500">
              <ShieldCheck className="h-7 w-7 text-white" />
            </div>

            <div>
              <div className="text-xl font-semibold leading-tight">
                AuditFlow
              </div>
              <div className="text-sm text-slate-300">Audit management</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6">
          <div className="space-y-2">
            {items
              .filter((item) => item.show)
              .map((item) => {
                const active =
                  item.to === "/dashboard"
                    ? location.pathname === "/dashboard"
                    : location.pathname === item.to ||
                      location.pathname.startsWith(`${item.to}/`);

                const Icon = item.icon;

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-4 rounded-md px-4 py-3 text-base font-medium transition-colors",
                      active
                        ? "bg-white/10 text-white"
                        : "text-slate-200 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
          </div>
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <div className="mb-3 rounded-md bg-white/5 px-3 py-2 text-xs text-slate-300">
            <div className="font-medium text-white">Signed in as</div>
            <div className="mt-1 truncate">{user.email}</div>
            <div className="mt-1 truncate">
              {roles.map((r) => r.replace("_", " ")).join(" · ") || "no role"}
            </div>
          </div>

          <Button
            variant="ghost"
            className="w-full justify-start text-slate-200 hover:bg-white/5 hover:text-white"
            onClick={signOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
