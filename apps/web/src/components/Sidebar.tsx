import { memo, useEffect, useRef, useState } from "react";
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
  const navRef = useRef<HTMLElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({
    top: 0,
    height: 0,
    opacity: 0,
  });

  useEffect(() => {
    // Use a small timeout to let the DOM settle, especially after expand/collapse
    const timer = setTimeout(() => {
      if (!navRef.current) return;
      const activeEl = navRef.current.querySelector(
        '[data-active="true"]',
      ) as HTMLElement;
      if (activeEl) {
        let topOffset = activeEl.offsetTop;
        let pHeight = parseInt(
          activeEl.getAttribute("data-indicator-height") || "24",
          10,
        );
        let pTopPadding = parseInt(
          activeEl.getAttribute("data-indicator-padding") || "8",
          10,
        );

        setIndicatorStyle({
          top: topOffset + pTopPadding,
          height: pHeight,
          opacity: 1,
        });
      } else {
        setIndicatorStyle((prev) => ({ ...prev, opacity: 0 }));
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [activeKey, collapsed, items]);

  return (
    <aside
      className={`fixed left-0 top-0 h-screen border-r border-slate-800 bg-slate-900 p-5 flex flex-col transition-all duration-300 ${
        collapsed ? "w-20" : "w-64"
      } ${className ?? ""}`}
    >
      <div
        className={`flex items-center pb-4 border-b border-slate-800 ${
          collapsed ? "justify-center" : "justify-start"
        }`}
      >
        <div className="h-10 w-10 rounded-xl bg-blue-500 text-white flex items-center justify-center font-semibold shadow-sm">
          T
        </div>
        {!collapsed && (
          <p className="ml-3 text-[15px] font-bold tracking-tight text-white">
            Ticket
          </p>
        )}
      </div>

      <nav ref={navRef} className="mt-6 flex-1 space-y-1 relative">
        <div
          className="absolute left-[-20px] w-1 rounded-r-full bg-blue-500 transition-all duration-300 [transition-timing-function:cubic-bezier(0.4,0,0.2,1)] z-10"
          style={{
            top: indicatorStyle.top,
            height: indicatorStyle.height,
            opacity: indicatorStyle.opacity,
          }}
          aria-hidden="true"
        />

        {items.map((item) => {
          const isActive = activeKey === item.key;
          const label =
            item.key === "created" && currentRole === "EMPLOYEE"
              ? "My Tickets"
              : item.label;
          const showAdminArrow =
            !collapsed &&
            item.key === "admin" &&
            showAdminSidebarTrigger &&
            typeof onOpenAdminSidebar === "function";
          return (
            <div key={item.key}>
              <button
                type="button"
                data-active={isActive}
                data-indicator-height="24"
                data-indicator-padding="8"
                onClick={
                  showAdminArrow && onOpenAdminSidebar
                    ? () => onOpenAdminSidebar()
                    : () => onSelect(item.key)
                }
                className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200 ${
                  collapsed ? "justify-center" : ""
                } ${
                  isActive
                    ? "bg-slate-800 text-white shadow-sm"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                <span className="flex-shrink-0">
                  <item.icon
                    className={`h-5 w-5 transition-colors ${isActive ? "text-blue-400" : "text-slate-500 group-hover:text-slate-300"}`}
                  />
                </span>
                {!collapsed && (
                  <span className="flex-1 text-left truncate flex items-center justify-between pr-2">
                    <span className="flex items-center gap-2">{label}</span>
                    {typeof item.badge === "number" && item.badge > 0 && (
                      <span
                        className={`flex-shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          isActive
                            ? "bg-blue-500 text-white"
                            : "bg-slate-700 text-slate-300 group-hover:bg-slate-600 group-hover:text-white transition-colors"
                        }`}
                      >
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}
                  </span>
                )}
                {!collapsed && showAdminArrow && (
                  <ArrowRight
                    className={`h-4 w-4 flex-shrink-0 ${isActive ? "text-blue-400" : "text-slate-600 group-hover:text-slate-400"}`}
                  />
                )}
              </button>

              {!collapsed && item.children && item.children.length > 0 && (
                <div className="mt-1.5 ml-11 space-y-1 border-l border-slate-700/50 pl-3">
                  {item.children.map((child) => {
                    const childActive = activeKey === child.key;
                    return (
                      <button
                        key={child.key}
                        type="button"
                        data-active={childActive}
                        data-indicator-height="20"
                        data-indicator-padding="6"
                        onClick={() => onSelect(child.key)}
                        className={`relative w-full text-left text-[13px] font-medium px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
                          childActive
                            ? "bg-slate-800 text-white shadow-sm"
                            : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full transition-colors ${
                            childActive ? "bg-blue-400" : "bg-slate-600"
                          }`}
                        />
                        <span className="truncate flex-1" title={child.label}>
                          {child.label}
                        </span>
                        {typeof child.badge === "number" && child.badge > 0 && (
                          <span
                            className={`flex-shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full flex items-center justify-between text-[10px] font-bold ${
                              childActive
                                ? "bg-blue-500 text-white"
                                : "bg-slate-700 text-slate-300 group-hover:bg-slate-600 group-hover:text-white transition-colors"
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

      {onCreateTicket && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onCreateTicket}
            className={`w-full inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors ${collapsed ? "justify-center" : ""}`}
          >
            <Plus className="h-5 w-5 flex-shrink-0" />
            {!collapsed && <span>New Ticket</span>}
          </button>
        </div>
      )}

      <div className="mt-6 border-t border-slate-800 pt-4 flex items-center justify-between">
        {!collapsed && <span />}
        {!hideCollapseToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="h-8 w-8 rounded-full border border-slate-700 bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
    </aside>
  );
});
