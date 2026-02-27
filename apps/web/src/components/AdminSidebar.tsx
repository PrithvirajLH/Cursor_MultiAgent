import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  BarChart3,
  Bot,
  FileText,
  Shield,
  Tags,
  Wrench,
  type LucideIcon
} from 'lucide-react';
import type { Role } from '../types';

type AdminRoute =
  | '/sla-settings'
  | '/routing'
  | '/automation'
  | '/custom-fields'
  | '/audit-log'
  | '/categories'
  | '/reports';

type AdminSidebarItem = {
  key:
  | 'sla-settings'
  | 'routing'
  | 'automation'
  | 'custom-fields'
  | 'audit-log'
  | 'categories'
  | 'reports';
  label: string;
  route: AdminRoute;
  icon: LucideIcon;
  roles: Role[];
};

const adminItems: AdminSidebarItem[] = [
  {
    key: 'sla-settings',
    label: 'SLA Policies',
    route: '/sla-settings',
    icon: Shield,
    roles: ['TEAM_ADMIN', 'OWNER']
  },
  {
    key: 'routing',
    label: 'Routing Rules',
    route: '/routing',
    icon: ArrowRightLeft,
    roles: ['TEAM_ADMIN', 'OWNER']
  },
  {
    key: 'automation',
    label: 'Automation Rules',
    route: '/automation',
    icon: Bot,
    roles: ['TEAM_ADMIN', 'OWNER']
  },
  {
    key: 'custom-fields',
    label: 'Custom Fields',
    route: '/custom-fields',
    icon: Wrench,
    roles: ['TEAM_ADMIN', 'OWNER']
  },
  {
    key: 'audit-log',
    label: 'Audit Logs',
    route: '/audit-log',
    icon: FileText,
    roles: ['TEAM_ADMIN', 'OWNER']
  },
  {
    key: 'categories',
    label: 'Categories',
    route: '/categories',
    icon: Tags,
    roles: ['OWNER']
  },
  {
    key: 'reports',
    label: 'Reports',
    route: '/reports',
    icon: BarChart3,
    roles: ['TEAM_ADMIN', 'OWNER']
  }
];

function isItemActive(route: AdminRoute, pathname: string): boolean {
  const effectivePathname = pathname.startsWith('/admin') ? '/sla-settings' : pathname;
  if (route === '/sla-settings') return effectivePathname.startsWith('/sla-settings');
  if (route === '/routing') return effectivePathname.startsWith('/routing');
  if (route === '/automation') return effectivePathname.startsWith('/automation');
  if (route === '/custom-fields') return effectivePathname.startsWith('/custom-fields');
  if (route === '/audit-log') return effectivePathname.startsWith('/audit-log');
  if (route === '/reports') return effectivePathname.startsWith('/reports');
  return effectivePathname.startsWith('/categories');
}

export function AdminSidebar({
  visible,
  role,
  pathname,
  onBack,
  onNavigate,
  className
}: {
  visible: boolean;
  role: Role;
  pathname: string;
  onBack: () => void;
  onNavigate: (route: AdminRoute) => void;
  className?: string;
}) {
  const items = adminItems.filter((item) => item.roles.includes(role));
  const navRef = useRef<HTMLElement | null>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ top: 0, height: 0, opacity: 0 });

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!navRef.current || !visible) {
        return;
      }

      const activeEl = navRef.current.querySelector('[data-active="true"]') as HTMLElement | null;

      if (activeEl) {
        const topOffset = activeEl.offsetTop;
        const pHeight = parseInt(activeEl.getAttribute('data-indicator-height') || '24', 10);
        const pTopPadding = parseInt(activeEl.getAttribute('data-indicator-padding') || '8', 10);

        setIndicatorStyle({
          top: topOffset + pTopPadding,
          height: pHeight,
          opacity: 1
        });
      } else {
        setIndicatorStyle((prev) => ({ ...prev, opacity: 0 }));
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [items, pathname, visible]);

  return (
    <aside
      className={`fixed left-0 top-0 z-50 h-screen w-64 border-r border-slate-800 bg-slate-900 p-5 transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        } ${className ?? ''}`}
      aria-hidden={!visible}
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-800 pb-4">
          <button
            type="button"
            onClick={onBack}
            className="group w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
          >
            <ArrowLeft className="h-5 w-5 flex-shrink-0 text-slate-500 group-hover:text-slate-300 transition-colors" />
            <span className="truncate text-left">Back</span>
          </button>
        </div>

        <nav
          ref={navRef}
          className="mt-6 flex-1 space-y-1 overflow-y-auto overflow-x-visible pr-1 custom-scrollbar relative"
        >
          <div
            className="absolute left-0 w-1 rounded-r-full bg-blue-500 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] z-10"
            style={{
              top: indicatorStyle.top,
              height: indicatorStyle.height,
              opacity: indicatorStyle.opacity
            }}
            aria-hidden="true"
          />
          {items.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item.route, pathname);
            return (
              <button
                key={item.key}
                type="button"
                data-active={active}
                data-indicator-height="24"
                data-indicator-padding="8"
                onClick={() => onNavigate(item.route)}
                className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${active
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
              >
                <Icon className={`h-5 w-5 flex-shrink-0 transition-colors ${active ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                <span className="truncate text-left">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-6 border-t border-slate-800 pt-4 flex items-center justify-between">
          <span />
        </div>
      </div>
    </aside>
  );
}
