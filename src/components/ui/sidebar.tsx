import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  ListTodo,
  Shield,
  Users,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

type NavItem = {
  title: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Array<"admin" | "leader" | "auditor">;
};

export function AppSidebar() {
  const { hasRole } = useAuth();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const items: NavItem[] = [
    {
      title: "Dashboard",
      to: "/",
      icon: LayoutDashboard,
      roles: ["admin", "leader"],
    },
    {
      title: "Users",
      to: "/users",
      icon: Users,
      roles: ["admin"],
    },
    {
      title: "Audit Groups",
      to: "/audit-groups",
      icon: UserCheck,
      roles: ["admin", "leader"],
    },
    {
      title: "Activity Log",
      to: "/activity-log",
      icon: Activity,
      roles: ["admin"],
    },
    {
      title: "My Surveys",
      to: "/surveys",
      icon: FileText,
      roles: ["admin", "leader"],
    },
    {
      title: "Action Plans",
      to: "/action-plans",
      icon: ListTodo,
      roles: ["admin", "leader"],
    },
    {
      title: "Assigned Audits",
      to: "/assigned",
      icon: ClipboardCheck,
      roles: ["admin", "leader", "auditor"],
    },
  ];

  const visibleItems = items.filter((item) => {
    if (!item.roles || item.roles.length === 0) return true;

    return item.roles.some((role) => hasRole(role));
  });

  const isActive = (to: string) => {
    if (to === "/") return pathname === "/";
    return pathname === to || pathname.startsWith(`${to}/`);
  };

  return (
    <aside className="flex h-screen w-[308px] flex-col border-r bg-[#031B38] text-white">
      <div className="border-b border-white/10 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-cyan-500/90">
            <Shield className="h-7 w-7 text-white" />
          </div>

          <div>
            <div className="text-[2rem] font-semibold leading-none">
              AuditFlow
            </div>
            <div className="mt-1 text-lg text-slate-300">
              Audit management
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-4 py-6">
        <div className="space-y-2">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);

            return (
              <Link
                key={item.title}
                to={item.to}
                className={cn(
                  "flex items-center gap-4 rounded-lg px-4 py-3 text-[1.05rem] font-medium transition-colors",
                  active
                    ? "bg-white/10 text-white"
                    : "text-slate-200 hover:bg-white/5 hover:text-white"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{item.title}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
