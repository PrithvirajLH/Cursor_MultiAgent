import { Link, useLocation } from 'react-router-dom';
import { Icn, I, Avatar } from '../atoms';

interface NavItem {
  to: string;
  icon: typeof I.inbox;
  label: string;
  count?: string;
  hasDot?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/dashboard',   icon: I.chart,  label: 'Dashboard' },
  { to: '/tickets',     icon: I.inbox,  label: 'Inbox',       count: '142' },
  { to: '/my-tickets',  icon: I.ticket, label: 'My tickets',  count: '14'  },
  { to: '/team',        icon: I.users,  label: 'Team queue',  count: '38'  },
  { to: '/watching',    icon: I.eye,    label: 'Watching',    count: '7'   },
  { to: '/mentions',    icon: I.bell,   label: 'Mentions',    count: '3', hasDot: true },
];

const SAVED_VIEWS = [
  { label: 'P1 today',                count: '4',  tone: 'red'   as const },
  { label: 'Awaiting reply > 24h',    count: '11', tone: 'amber' as const },
  { label: 'Breach risk · 1h',        count: '8',  tone: 'amber' as const },
  { label: 'Unassigned',              count: '17', tone: 'gray'  as const },
  { label: 'Enterprise tier',         count: '52', tone: 'gray'  as const },
  { label: 'API errors',              count: '9',  tone: 'gray'  as const },
];

const TEAMS = [
  { label: 'Platform',   color: 'var(--c-accent)', count: '38' },
  { label: 'Identity',   color: 'var(--c-amber)',  count: '24' },
  { label: 'Data',       color: 'var(--c-green)',  count: '19' },
  { label: 'Mobile',     color: 'var(--c-purple)', count: '14' },
  { label: 'Compliance', color: 'var(--c-fg-3)',   count: '6'  },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  const isActive = (to: string) => pathname.startsWith(to);

  return (
    <aside
      className="w-[224px] flex flex-col flex-none border-r"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      {/* Workspace switcher */}
      <div
        className="px-3.5 py-3 flex items-center gap-2 border-b"
        style={{ borderColor: 'var(--c-border)' }}
      >
        <div
          className="w-6 h-6 rounded grid place-items-center text-[11px] font-bold tracking-tighter"
          style={{ backgroundColor: 'var(--c-fg)', color: 'white' }}
        >HD</div>
        <div className="flex flex-col min-w-0 flex-1">
          <div className="text-[12px] font-semibold leading-tight">Helpdesk</div>
          <div className="text-[10px]" style={{ color: 'var(--c-fg-4)' }}>CSH · Production</div>
        </div>
        <Icn d={I.chevD} s={11} />
      </div>

      {/* Scrollable nav */}
      <div className="p-2 text-[12px] flex-1 overflow-auto">
        {PRIMARY_NAV.map(r => {
          const active = isActive(r.to);
          return (
            <Link
              key={r.to}
              to={r.to}
              className="flex items-center gap-2 px-2 py-1 rounded-[3px] mb-px"
              style={{
                backgroundColor: active ? 'var(--c-accent-tint)' : 'transparent',
                color: active ? 'var(--c-accent)' : 'var(--c-fg-2)',
                fontWeight: active ? 600 : 500,
              }}
            >
              <Icn d={r.icon} s={14} />
              <span className="flex-1">{r.label}</span>
              {r.hasDot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--c-red)' }} />}
              {r.count && (
                <span className="font-mono text-[10px]" style={{ color: active ? 'var(--c-accent)' : 'var(--c-fg-4)' }}>
                  {r.count}
                </span>
              )}
            </Link>
          );
        })}

        {/* Saved views */}
        <div className="px-2 pt-3.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] flex justify-between" style={{ color: 'var(--c-fg-4)' }}>
          <span>Saved views</span><Icn d={I.plus} s={11} />
        </div>
        {SAVED_VIEWS.map(v => (
          <div key={v.label} className="flex items-center gap-2 px-2 py-1 text-[12px]">
            <span
              className="w-1.5 h-1.5 rounded-full flex-none"
              style={{
                backgroundColor:
                  v.tone === 'red' ? 'var(--c-red)' : v.tone === 'amber' ? 'var(--c-amber)' : 'var(--c-fg-5)',
              }}
            />
            <span className="flex-1 min-w-0 truncate">{v.label}</span>
            <span className="font-mono text-[10px]" style={{ color: 'var(--c-fg-4)' }}>{v.count}</span>
          </div>
        ))}

        {/* Teams */}
        <div className="px-2 pt-3.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--c-fg-4)' }}>Teams</div>
        {TEAMS.map(t => (
          <div key={t.label} className="flex items-center gap-2 px-2 py-1 text-[12px]">
            <span className="w-2 h-2 rounded-sm flex-none" style={{ backgroundColor: t.color }} />
            <span className="flex-1">{t.label}</span>
            <span className="font-mono text-[10px]" style={{ color: 'var(--c-fg-4)' }}>{t.count}</span>
          </div>
        ))}
      </div>

      {/* User card (bottom) */}
      <div
        className="p-2.5 border-t flex items-center gap-2"
        style={{ borderColor: 'var(--c-border)' }}
      >
        <Avatar name="EM" tone="f" />
        <div className="text-[12px] flex-1 min-w-0">
          <div className="truncate font-medium">Elena Marquez</div>
          <div className="text-[10px] flex items-center gap-1" style={{ color: 'var(--c-fg-4)' }}>
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: 'var(--c-green)' }} />
            Online
          </div>
        </div>
        <Icn d={I.settings} s={14} />
      </div>
    </aside>
  );
}
