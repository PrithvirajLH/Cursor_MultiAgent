import { memo } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "../types";

export type SidebarItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  children?: SidebarItem[];
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
}) {
  return (
    <aside
      className={`fixed left-0 top-0 h-screen flex flex-col transition-all duration-300 border-r border-white/[0.07] ${
        collapsed ? "w-[72px]" : "w-[248px]"
      } ${className ?? ""}`}
      style={{ background: "hsl(222 52% 7%)" }}
    >
      {/* ── Brand ── */}
      <div
        className={`flex items-center px-4 py-[18px] border-b border-white/[0.07] flex-shrink-0 ${
          collapsed ? "justify-center" : "gap-3"
        }`}
      >
        <div className="flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center font-bold text-[13px] text-white shadow-lg shadow-cyan-500/20"
          style={{ background: "linear-gradient(135deg, #14d4f4 0%, #3b82f6 100%)" }}
        >
          T
        </div>
        {!collapsed && (
          <span className="text-[15px] font-semibold tracking-tight text-white/90">
            Ticket
          </span>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3 space-y-0.5">
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
                  isAdminTrigger && onOpenAdminSidebar
                    ? onOpenAdminSidebar
                    : () => onSelect(item.key)
                }
                title={collapsed ? label : undefined}
                className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                  collapsed ? "justify-center" : ""
                } ${
                  isActive
                    ? "bg-white/[0.09] text-white"
                    : "text-white/40 hover:bg-white/[0.06] hover:text-white/70"
                }`}
              >
                {/* Active left-bar indicator */}
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                    style={{ background: "hsl(var(--primary))" }}
                    aria-hidden="true"
                  />
                )}

                <item.icon
                  className={`flex-shrink-0 h-[18px] w-[18px] transition-colors duration-150 ${
                    isActive
                      ? "text-[hsl(var(--primary))]"
                      : "text-white/30 group-hover:text-white/55"
                  }`}
                />

                {!collapsed && (
                  <>
                    <span className="flex-1 text-left truncate">{label}</span>

                    {typeof item.badge === "number" && item.badge > 0 && (
                      <span
                        className={`flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums ${
                          isActive
                            ? "bg-[hsl(var(--primary)/0.2)] text-[hsl(var(--primary))]"
                            : "bg-white/[0.09] text-white/40 group-hover:text-white/60"
                        }`}
                      >
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}

                    {isAdminTrigger && (
                      <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-white/25 group-hover:text-white/45 transition-colors" />
                    )}
                  </>
                )}
              </button>

              {/* Children */}
              {!collapsed && item.children && item.children.length > 0 && (
                <div className="mt-0.5 ml-9 pl-3 border-l border-white/[0.08] space-y-0.5">
                  {item.children.map((child) => {
                    const childActive = activeKey === child.key;
                    return (
                      <button
                        key={child.key}
                        type="button"
                        onClick={() => onSelect(child.key)}
                        className={`w-full flex items-center gap-2 px-2.5 py-[7px] rounded-md text-[12.5px] font-medium transition-all duration-150 ${
                          childActive
                            ? "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]"
                            : "text-white/35 hover:text-white/62 hover:bg-white/[0.05]"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full flex-shrink-0 transition-colors ${
                            childActive
                              ? "bg-[hsl(var(--primary))]"
                              : "bg-white/20"
                          }`}
                        />
                        <span className="flex-1 truncate text-left">
                          {child.label}
                        </span>
                        {typeof child.badge === "number" && child.badge > 0 && (
                          <span
                            className={`text-[10px] font-bold tabular-nums ${
                              childActive
                                ? "text-[hsl(var(--primary))]"
                                : "text-white/30"
                            }`}
                          >
                            {child.badge > 99 ? "99+" : child.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── New Ticket ── */}
      {onCreateTicket && (
        <div className="px-2.5 pb-2.5">
          <button
            type="button"
            onClick={onCreateTicket}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-semibold text-white transition-all duration-150 shadow-lg shadow-cyan-500/10 hover:shadow-cyan-500/20 ${
              collapsed ? "justify-center" : ""
            }`}
            style={{
              background: "linear-gradient(135deg, hsl(193 95% 55% / 0.85) 0%, hsl(217 91% 60% / 0.85) 100%)",
            }}
            title={collapsed ? "New Ticket" : undefined}
          >
            <Plus className="h-4 w-4 flex-shrink-0" />
            {!collapsed && <span>New Ticket</span>}
          </button>
        </div>
      )}

      {/* ── Collapse Toggle ── */}
      {!hideCollapseToggle && (
        <div className="px-2.5 pb-4 pt-2 border-t border-white/[0.07] flex-shrink-0">
          <button
            type="button"
            onClick={onToggle}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium text-white/28 hover:text-white/55 hover:bg-white/[0.06] transition-all duration-150 ${
              collapsed ? "justify-center" : ""
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
        </div>
      )}
    </aside>
  );
});
