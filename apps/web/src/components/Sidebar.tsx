import { ArrowRight, ChevronLeft, ChevronRight, Plus, type LucideIcon } from 'lucide-react';
import type { Role } from '../types';

export type SidebarItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  children?: SidebarItem[];
};

export function Sidebar({
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
  hideCollapseToggle = false
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
  function renderItemButton(
    item: SidebarItem,
    isActive: boolean,
    label: string,
    options?: {
      showAdminArrow?: boolean;
      onClick?: () => void;
    }
  ) {
    const Icon = item.icon;
    const showAdminArrow = options?.showAdminArrow === true;
    return (
      <button
        type="button"
        onClick={options?.onClick ?? (() => onSelect(item.key))}
        className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
          collapsed ? 'justify-center' : ''
        } ${
          isActive
            ? 'bg-slate-100 text-slate-900 shadow-soft'
            : 'text-slate-700 hover:bg-slate-100/80'
        }`}
      >
        {isActive && (
          <span
            className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-blue-600"
            aria-hidden
          />
        )}
        <span className="flex-shrink-0">
          <Icon className={`h-5 w-5 ${isActive ? 'text-blue-600' : 'text-slate-600'}`} />
        </span>
        {!collapsed && (
          <span className="flex-1 text-left truncate flex items-center gap-2">
            {label}
            {typeof item.badge === 'number' && item.badge > 0 && (
              <span
                className={`flex-shrink-0 min-w-[1.25rem] h-5 px-1 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                  isActive ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </span>
        )}
        {!collapsed && showAdminArrow && (
          <ArrowRight className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-500'}`} />
        )}
      </button>
    );
  }

  return (
    <aside
      className={`fixed left-0 top-0 h-screen border-r border-slate-200 bg-white p-5 flex flex-col transition-all duration-300 ${
        collapsed ? 'w-20' : 'w-64'
      } ${className ?? ''}`}
    >
      <div
        className={`flex items-center pb-4 border-b border-slate-200/60 ${
          collapsed ? 'justify-center' : 'justify-start'
        }`}
      >
        <div className="h-10 w-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-semibold shadow-soft">
          T
        </div>
        {!collapsed && <p className="ml-3 text-sm font-semibold text-slate-900">Ticket</p>}
      </div>

      <nav className="mt-6 flex-1 space-y-1">
        {items.map((item) => {
          const isActive = activeKey === item.key;
          const label = item.key === 'created' && currentRole === 'EMPLOYEE' ? 'My Tickets' : item.label;
          const showAdminArrow =
            !collapsed &&
            item.key === 'admin' &&
            showAdminSidebarTrigger &&
            typeof onOpenAdminSidebar === 'function';
          return (
            <div key={item.key}>
              {renderItemButton(item, isActive, label, {
                showAdminArrow,
                onClick:
                  showAdminArrow && onOpenAdminSidebar
                    ? () => onOpenAdminSidebar()
                    : () => onSelect(item.key)
              })}
              {!collapsed && item.children && item.children.length > 0 && (
                <div className="mt-1.5 ml-11 space-y-1 border-l border-slate-200/70 pl-3">
                  {item.children.map((child) => {
                    const childActive = activeKey === child.key;
                    return (
                      <button
                        key={child.key}
                        type="button"
                        onClick={() => onSelect(child.key)}
                        className={`relative w-full text-left text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
                          childActive
                            ? 'bg-slate-100 text-slate-900 shadow-soft'
                            : 'text-slate-600 hover:bg-slate-100/80'
                        }`}
                      >
                        {childActive && (
                          <span
                            className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-blue-600"
                            aria-hidden
                          />
                        )}
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            childActive ? 'bg-blue-600' : 'bg-slate-300'
                          }`}
                        />
                        <span className="truncate flex-1">{child.label}</span>
                        {typeof child.badge === 'number' && child.badge > 0 && (
                          <span
                            className={`flex-shrink-0 min-w-[1.25rem] h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-semibold ${
                              childActive ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {child.badge > 99 ? '99+' : child.badge}
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
            className={`w-full inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-blue-700 transition ${collapsed ? 'justify-center' : ''}`}
          >
            <Plus className="h-5 w-5 flex-shrink-0" />
            {!collapsed && <span>New Ticket</span>}
          </button>
        </div>
      )}

      <div className="mt-6 border-t border-slate-200/60 pt-4 flex items-center justify-between">
        {!collapsed && <span />}
        {!hideCollapseToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="h-8 w-8 rounded-full border border-slate-300 flex items-center justify-center text-slate-600 hover:text-slate-900"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        )}
      </div>
    </aside>
  );
}
