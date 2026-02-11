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
  if (route === '/sla-settings') return pathname.startsWith('/sla-settings');
  if (route === '/routing') return pathname.startsWith('/routing');
  if (route === '/automation') return pathname.startsWith('/automation');
  if (route === '/custom-fields') return pathname.startsWith('/custom-fields');
  if (route === '/audit-log') return pathname.startsWith('/audit-log');
  if (route === '/reports') return pathname.startsWith('/reports');
  return pathname.startsWith('/categories');
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

  return (
    <aside
      className={`fixed left-0 top-0 z-50 h-screen w-64 border-r border-slate-200 bg-white p-5 transition-transform duration-300 ease-out ${
        visible ? 'translate-x-0' : '-translate-x-full pointer-events-none'
      } ${className ?? ''}`}
      aria-hidden={!visible}
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-200/60 pb-4">
          <button
            type="button"
            onClick={onBack}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 text-slate-700 hover:bg-slate-100/80"
          >
            <ArrowLeft className="h-5 w-5 flex-shrink-0 text-slate-600" />
            <span className="truncate text-left">Back</span>
          </button>
        </div>

        <nav className="mt-6 flex-1 space-y-1 overflow-y-auto">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item.route, pathname);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.route)}
                className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'bg-slate-100 text-slate-900 shadow-soft'
                    : 'text-slate-700 hover:bg-slate-100/80'
                }`}
              >
                {active && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-blue-600"
                    aria-hidden
                  />
                )}
                <Icon className={`h-5 w-5 flex-shrink-0 ${active ? 'text-blue-600' : 'text-slate-600'}`} />
                <span className="truncate text-left">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-6 border-t border-slate-200/60 pt-4 flex items-center justify-between">
          <span />
        </div>
      </div>
    </aside>
  );
}
