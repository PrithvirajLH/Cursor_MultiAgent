import { memo, type ReactNode } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Moon,
  Plus,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "../types";

export type SidebarItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  children?: SidebarItem[];
  extraChildren?: ReactNode;
};

export const Sidebar = memo(function Sidebar({
  collapsed,
  onToggle,
  items,
  activeKey,
  onSelect,
  currentRole,
  onCreateTicket,
  className,
  showAdminSidebarTrigger = false,
  onOpenAdminSidebar,
  hideCollapseToggle = false,
  theme,
  onToggleTheme,
  extraNavContent,
}: {
  collapsed: boolean;
  onToggle?: () => void;
  items: SidebarItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  currentRole: Role;
  onCreateTicket?: () => void;
  className?: string;
  showAdminSidebarTrigger?: boolean;
  onOpenAdminSidebar?: () => void;
  hideCollapseToggle?: boolean;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  extraNavContent?: ReactNode;
}) {
  const dk = theme === "dark";

  return (
    <aside
      className={`fixed left-0 top-0 h-screen flex flex-col border-r ${
        dk ? "border-white/[0.07]" : "border-border"
      } ${collapsed ? "w-[64px]" : "w-[220px]"} ${className ?? ""}`}
      style={{
        background: dk ? "hsl(222 52% 7%)" : "hsl(var(--card))",
        transition: "width 300ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* ── Brand ── */}
      <div
        className={`flex items-center px-3 py-3 border-b flex-shrink-0 ${
          dk ? "border-white/[0.07]" : "border-border"
        } ${collapsed ? "justify-center" : "gap-2.5"}`}
      >
        <div
          className="flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center font-bold text-[12px] text-white shadow-md"
          style={{
            background: dk
              ? "linear-gradient(135deg, #14d4f4 0%, #3b82f6 100%)"
              : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
          }}
        >
          T
        </div>
        {!collapsed && (
          <span
            className={`text-[13.5px] font-semibold tracking-tight ${
              dk ? "text-white/90" : "text-foreground"
            }`}
          >
            Ticket
          </span>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 space-y-0.5">
        {items.map((item) => {
          const isActive = activeKey === item.key;
          const label =
            item.key === "created" && currentRole === "EMPLOYEE"
              ? "My Tickets"
              : item.label;
          const isAdminTrigger =
            item.key === "admin" &&
            showAdminSidebarTrigger &&
            typeof onOpenAdminSidebar === "function";

          return (
            <div key={item.key}>
              <button
                type="button"
                onClick={
                  isAdminTrigger
                    ? onOpenAdminSidebar
                    : () => onSelect(item.key)
                }
                title={collapsed ? label : undefined}
                className={`group relative w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12.5px] font-medium transition-all duration-150 ${
                  collapsed ? "justify-center" : ""
                } ${
                  isActive
                    ? dk
                      ? "bg-white/[0.09] text-white"
                      : "bg-primary/[0.08] text-primary font-semibold"
                    : dk
                      ? "text-white/40 hover:bg-white/[0.06] hover:text-white/70"
                      : "text-foreground/80 hover:bg-accent hover:text-foreground"
                }`}
              >
                {/* Active left-bar indicator */}
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-primary"
                    aria-hidden="true"
                  />
                )}

                <item.icon
                  className={`flex-shrink-0 h-[16px] w-[16px] transition-colors duration-150 ${
                    isActive
                      ? "text-primary"
                      : dk
                        ? "text-white/30 group-hover:text-white/55"
                        : "text-foreground/60 group-hover:text-foreground"
                  }`}
                />

                {!collapsed && (
                  <>
                    <span className="flex-1 text-left truncate">{label}</span>

                    {typeof item.badge === "number" && item.badge > 0 && (
                      <span
                        className={`flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums ${
                          isActive
                            ? "bg-primary/15 text-primary"
                            : dk
                              ? "bg-white/[0.09] text-white/40 group-hover:text-white/60"
                              : "bg-muted text-foreground/60 group-hover:text-foreground"
                        }`}
                      >
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}

                    {isAdminTrigger && (
                      <ArrowRight
                        className={`h-3.5 w-3.5 flex-shrink-0 transition-colors ${
                          dk
                            ? "text-white/20 group-hover:text-white/40"
                            : "text-foreground/40 group-hover:text-foreground/60"
                        }`}
                      />
                    )}
                  </>
                )}
              </button>

              {/* Children (sub-items) */}
              {!collapsed &&
                ((item.children && item.children.length > 0) ||
                  item.extraChildren) && (
                <div
                  className={`mt-0.5 ml-6 pl-2 border-l space-y-0.5 ${
                    dk ? "border-white/[0.08]" : "border-border"
                  }`}
                >
                  {item.children?.map((child) => {
                    const childActive = activeKey === child.key;
                    return (
                      <button
                        key={child.key}
                        type="button"
                        onClick={() => onSelect(child.key)}
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[12px] font-medium transition-all duration-150 ${
                          childActive
                            ? dk
                              ? "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]"
                              : "text-primary bg-primary/[0.08]"
                            : dk
                              ? "text-white/35 hover:text-white/62 hover:bg-white/[0.05]"
                              : "text-foreground/75 hover:text-foreground hover:bg-accent"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full flex-shrink-0 transition-colors ${
                            childActive
                              ? "bg-primary"
                              : dk
                                ? "bg-white/20"
                                : "bg-foreground/40"
                          }`}
                        />
                        <span className="flex-1 truncate text-left">
                          {child.label}
                        </span>
                        {typeof child.badge === "number" && child.badge > 0 && (
                          <span
                            className={`text-[10px] font-bold tabular-nums ${
                              childActive
                                ? "text-primary"
                                : dk
                                  ? "text-white/30"
                                  : "text-foreground/55"
                            }`}
                          >
                            {child.badge > 99 ? "99+" : child.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {item.extraChildren}
                </div>
              )}
            </div>
          );
        })}

        {extraNavContent}
      </nav>

      {/* ── New Ticket Button ── */}
      {onCreateTicket && (
        <div className="px-2 pb-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={onCreateTicket}
            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[12.5px] font-semibold text-white transition-all duration-150 shadow-md ${
              collapsed ? "justify-center" : ""
            }`}
            style={{
              background: dk
                ? "linear-gradient(135deg, hsl(193 95% 55% / 0.85) 0%, hsl(217 91% 60% / 0.85) 100%)"
                : "linear-gradient(135deg, hsl(245 58% 55%) 0%, hsl(260 60% 55%) 100%)",
            }}
            title={collapsed ? "New Ticket" : undefined}
          >
            <Plus className="h-4 w-4 flex-shrink-0" />
            {!collapsed && <span>New Ticket</span>}
          </button>
        </div>
      )}

      {/* ── Theme toggle + Collapse ── */}
      <div
        className={`px-2 pb-2.5 pt-1.5 border-t flex-shrink-0 space-y-0.5 ${
          dk ? "border-white/[0.07]" : "border-border"
        }`}
      >
        {/* Theme toggle */}
        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11.5px] font-medium transition-all duration-150 ${
              collapsed ? "justify-center" : ""
            } ${
              dk
                ? "text-white/28 hover:text-white/55 hover:bg-white/[0.06]"
                : "text-foreground/55 hover:text-foreground/80 hover:bg-accent"
            }`}
            aria-label={dk ? "Switch to light mode" : "Switch to dark mode"}
            title={
              collapsed
                ? dk
                  ? "Light mode"
                  : "Dark mode"
                : undefined
            }
          >
            {dk ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
            {!collapsed && (
              <span>{dk ? "Light Mode" : "Dark Mode"}</span>
            )}
          </button>
        )}

        {/* Collapse toggle */}
        {!hideCollapseToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11.5px] font-medium transition-all duration-150 ${
              collapsed ? "justify-center" : ""
            } ${
              dk
                ? "text-white/28 hover:text-white/55 hover:bg-white/[0.06]"
                : "text-foreground/55 hover:text-foreground/80 hover:bg-accent"
            }`}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );
});
