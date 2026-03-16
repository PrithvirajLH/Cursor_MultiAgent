import {
  ArrowLeft,
  ArrowRightLeft,
  BarChart3,
  Bot,
  FileText,
  Shield,
  Tags,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "../types";

type AdminRoute =
  | "/sla-settings"
  | "/routing"
  | "/automation"
  | "/custom-fields"
  | "/audit-log"
  | "/categories"
  | "/reports";

type AdminSidebarItem = {
  key:
    | "sla-settings"
    | "routing"
    | "automation"
    | "custom-fields"
    | "audit-log"
    | "categories"
    | "reports";
  label: string;
  route: AdminRoute;
  icon: LucideIcon;
  roles: Role[];
  description?: string;
};

const adminItems: AdminSidebarItem[] = [
  {
    key: "sla-settings",
    label: "SLA Policies",
    route: "/sla-settings",
    icon: Shield,
    roles: ["TEAM_ADMIN", "OWNER"],
    description: "Response & resolution targets",
  },
  {
    key: "routing",
    label: "Routing Rules",
    route: "/routing",
    icon: ArrowRightLeft,
    roles: ["TEAM_ADMIN", "OWNER"],
    description: "Keyword-based assignment",
  },
  {
    key: "automation",
    label: "Automation",
    route: "/automation",
    icon: Bot,
    roles: ["TEAM_ADMIN", "OWNER"],
    description: "Trigger-based actions",
  },
  {
    key: "custom-fields",
    label: "Custom Fields",
    route: "/custom-fields",
    icon: Wrench,
    roles: ["TEAM_ADMIN", "OWNER"],
    description: "Per-team field definitions",
  },
  {
    key: "audit-log",
    label: "Audit Logs",
    route: "/audit-log",
    icon: FileText,
    roles: ["TEAM_ADMIN", "OWNER"],
    description: "Changes & compliance trail",
  },
  {
    key: "categories",
    label: "Categories",
    route: "/categories",
    icon: Tags,
    roles: ["OWNER"],
    description: "Ticket categorization",
  },
  {
    key: "reports",
    label: "Reports",
    route: "/reports",
    icon: BarChart3,
    roles: ["TEAM_ADMIN", "OWNER"],
    description: "Analytics & insights",
  },
];

function isItemActive(route: AdminRoute, pathname: string): boolean {
  let effectivePathname = pathname;

  if (pathname.startsWith("/admin")) {
    const withoutAdmin = pathname.slice("/admin".length) || "/sla-settings";
    effectivePathname = withoutAdmin.startsWith("/")
      ? withoutAdmin
      : `/${withoutAdmin}`;
  }

  if (route === "/sla-settings")
    return effectivePathname.startsWith("/sla-settings");
  if (route === "/routing") return effectivePathname.startsWith("/routing");
  if (route === "/automation")
    return effectivePathname.startsWith("/automation");
  if (route === "/custom-fields")
    return effectivePathname.startsWith("/custom-fields");
  if (route === "/audit-log") return effectivePathname.startsWith("/audit-log");
  if (route === "/reports") return effectivePathname.startsWith("/reports");
  return effectivePathname.startsWith("/categories");
}

export function AdminSidebar({
  visible,
  role,
  pathname,
  onBack,
  onNavigate,
  className,
}: {
  visible: boolean;
  role: Role;
  pathname: string;
  onBack: () => void;
  onNavigate: (route: AdminRoute) => void;
  className?: string;
}) {
  const items = adminItems.filter((item) => item.roles.includes(role));

  return (
    <aside
      className={`fixed left-0 top-0 z-50 h-screen w-[248px] border-r border-white/[0.07] flex flex-col transition-transform duration-300 ease-out ${
        visible ? "translate-x-0" : "-translate-x-full pointer-events-none"
      } ${className ?? ""}`}
      style={{ background: "hsl(222 52% 7%)" }}
      aria-hidden={!visible}
    >
      {/* Header */}
      <div className="px-4 py-[18px] border-b border-white/[0.07] flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 text-white/40 hover:text-white/70 hover:bg-white/[0.06]"
        >
          <ArrowLeft className="h-4 w-4 flex-shrink-0 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to Menu</span>
        </button>
      </div>

      {/* Section label */}
      <div className="px-5 pt-5 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/25">
          Administration
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-1 space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item.route, pathname);

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.route)}
              className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                active
                  ? "bg-white/[0.09] text-white"
                  : "text-white/40 hover:bg-white/[0.06] hover:text-white/70"
              }`}
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                  style={{ background: "hsl(var(--primary))" }}
                  aria-hidden="true"
                />
              )}

              <Icon
                className={`flex-shrink-0 h-[18px] w-[18px] transition-colors duration-150 ${
                  active
                    ? "text-[hsl(var(--primary))]"
                    : "text-white/30 group-hover:text-white/55"
                }`}
              />

              <div className="flex-1 text-left min-w-0">
                <div className="truncate">{item.label}</div>
                {item.description && (
                  <div className="text-[11px] truncate mt-0.5 text-white/25 font-normal">
                    {item.description}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </nav>

      <div className="px-2.5 pb-4 pt-2 border-t border-white/[0.07] flex-shrink-0">
        <div className="px-3 py-2.5 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
          <p className="text-[11px] text-white/35 leading-relaxed">
            Admin settings are visible only to Team Admins and Owners.
          </p>
        </div>
      </div>
    </aside>
  );
}
