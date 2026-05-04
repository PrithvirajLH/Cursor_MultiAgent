import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteSavedView,
  fetchSavedViews,
  fetchTeams,
  fetchTicketCounts,
  type SavedViewRecord,
} from '../../api/client';
import { useAuthSession } from '../../hooks/useAuthSession';
import { Icn, I, Avatar } from '../atoms';
import {
  PRIMARY_NAV_PRESETS,
  SAVED_VIEWS,
  type SidebarPreset,
  type ToneKey,
} from './saved-views';

interface PrimaryNavLink {
  to: string;
  icon: typeof I.inbox;
  label: string;
  count?: string;
  hasDot?: boolean;
}

const ICON_FOR_PRESET: Record<string, typeof I.inbox> = {
  'inbox':         I.inbox,
  'my-tickets':    I.ticket,
  'team-queue':    I.users,
  'created-by-me': I.note,
};

const STANDALONE_LINKS: PrimaryNavLink[] = [
  { to: '/dashboard', icon: I.chart, label: 'Dashboard' },
  { to: '/watching',  icon: I.eye,   label: 'Watching',  count: '7' },
  { to: '/mentions',  icon: I.bell,  label: 'Mentions',  count: '3', hasDot: true },
];

// Stable color palette for teams in display order — extends beyond 5 by cycling.
const TEAM_COLORS = [
  'var(--c-accent)',
  'var(--c-amber)',
  'var(--c-green)',
  'var(--c-purple)',
  'var(--c-blue)',
  'var(--c-fg-3)',
];

/**
 * Maps a count overlay to a primary-nav preset id.
 * If a preset id is missing here, it falls back to the hard-coded value
 * in saved-views.ts.
 */
function countForPreset(
  presetId: string,
  counts: Awaited<ReturnType<typeof fetchTicketCounts>> | undefined,
): string | undefined {
  if (!counts) return undefined;
  switch (presetId) {
    case 'inbox':         return String(counts.open);
    case 'my-tickets':    return String(counts.assignedToMe);
    case 'team-queue':    return String(counts.unassigned);
    case 'created-by-me': return String(counts.createdByMeOpen);
    default:              return undefined;
  }
}

const TONE_COLOR: Record<ToneKey, string> = {
  red:   'var(--c-red)',
  amber: 'var(--c-amber)',
  green: 'var(--c-green)',
  gray:  'var(--c-fg-5)',
};

export function AppSidebar() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const onTicketsRevamp = pathname.startsWith('/tickets-revamp');
  const { user, loading: authLoading } = useAuthSession();
  const authReady = !!user && !authLoading;

  // Live counts driving Inbox / My tickets / Team queue / Created-by-me badges.
  const { data: counts } = useQuery({
    queryKey: ['ticket-counts'],
    queryFn: () => fetchTicketCounts(),
    staleTime: 60_000,
    enabled: authReady,
  });

  // Real teams replacing the hard-coded list.
  const { data: teams } = useQuery({
    queryKey: ['teams'],
    queryFn: ({ signal }) => fetchTeams({ signal }),
    staleTime: 5 * 60_000,
    enabled: authReady,
  });

  // User-created saved views.
  const { data: userSavedViews } = useQuery({
    queryKey: ['saved-views'],
    queryFn: () => fetchSavedViews(),
    staleTime: 60_000,
    enabled: authReady,
  });

  const teamList = (teams?.data ?? []).map((t, i) => ({
    id: t.id,
    label: t.name,
    color: TEAM_COLORS[i % TEAM_COLORS.length],
  }));

  const presetIsActive = (preset: SidebarPreset) =>
    onTicketsRevamp && preset.matches(searchParams);

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
        {/* Standalone (Dashboard) — non-revamp routes */}
        {STANDALONE_LINKS.slice(0, 1).map(r => {
          const active = pathname.startsWith(r.to);
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
              {r.count && (
                <span className="font-mono text-[10px]" style={{ color: active ? 'var(--c-accent)' : 'var(--c-fg-4)' }}>
                  {r.count}
                </span>
              )}
            </Link>
          );
        })}

        {/* Primary nav presets — all link to /tickets-revamp with preset query */}
        {PRIMARY_NAV_PRESETS.map(p => {
          const active = presetIsActive(p);
          const icon = ICON_FOR_PRESET[p.id] ?? I.inbox;
          const liveCount = countForPreset(p.id, counts);
          const count = liveCount ?? p.count;
          return (
            <Link
              key={p.id}
              to={`/tickets-revamp${p.buildQuery()}`}
              className="flex items-center gap-2 px-2 py-1 rounded-[3px] mb-px"
              style={{
                backgroundColor: active ? 'var(--c-accent-tint)' : 'transparent',
                color: active ? 'var(--c-accent)' : 'var(--c-fg-2)',
                fontWeight: active ? 600 : 500,
              }}
            >
              <Icn d={icon} s={14} />
              <span className="flex-1">{p.label}</span>
              {count && (
                <span className="font-mono text-[10px]" style={{ color: active ? 'var(--c-accent)' : 'var(--c-fg-4)' }}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}

        {/* Standalone non-list links (Watching, Mentions) */}
        {STANDALONE_LINKS.slice(1).map(r => {
          const active = pathname.startsWith(r.to);
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

        {/* Saved views — preset filters */}
        <div className="px-2 pt-3.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] flex justify-between" style={{ color: 'var(--c-fg-4)' }}>
          <span>Saved views</span><Icn d={I.plus} s={11} />
        </div>
        {SAVED_VIEWS.map(v => {
          const active = presetIsActive(v);
          return (
            <Link
              key={v.id}
              to={`/tickets-revamp${v.buildQuery()}`}
              className="flex items-center gap-2 px-2 py-1 text-[12px] rounded-[3px] mb-px"
              style={{
                backgroundColor: active ? 'var(--c-accent-tint)' : 'transparent',
                color: active ? 'var(--c-accent)' : 'var(--c-fg-2)',
                fontWeight: active ? 600 : 400,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-none"
                style={{ backgroundColor: TONE_COLOR[v.tone ?? 'gray'] }}
              />
              <span className="flex-1 min-w-0 truncate">{v.label}</span>
              {v.count && (
                <span className="font-mono text-[10px]" style={{ color: active ? 'var(--c-accent)' : 'var(--c-fg-4)' }}>
                  {v.count}
                </span>
              )}
            </Link>
          );
        })}

        {/* User-saved views (CRUD) */}
        {userSavedViews && userSavedViews.length > 0 && (
          <>
            <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--c-fg-4)' }}>
              Mine
            </div>
            {userSavedViews.map(v => (
              <UserSavedViewLink
                key={v.id}
                view={v}
                onTicketsRevamp={onTicketsRevamp}
                searchParams={searchParams}
              />
            ))}
          </>
        )}

        {/* Teams — clickable, filters list by teamId */}
        <div className="px-2 pt-3.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--c-fg-4)' }}>Teams</div>
        {teamList.length === 0 ? (
          <div className="px-2 py-1 text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
            {authReady ? '—' : 'Loading…'}
          </div>
        ) : (
          teamList.map(t => {
            const active = onTicketsRevamp && searchParams.get('teamIds') === t.id;
            return (
              <Link
                key={t.id}
                to={`/tickets-revamp?teamIds=${encodeURIComponent(t.id)}`}
                className="flex items-center gap-2 px-2 py-1 text-[12px] rounded-[3px] mb-px"
                style={{
                  backgroundColor: active ? 'var(--c-accent-tint)' : 'transparent',
                  color: active ? 'var(--c-accent)' : 'var(--c-fg-2)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                <span className="w-2 h-2 rounded-sm flex-none" style={{ backgroundColor: t.color }} />
                <span className="flex-1 truncate">{t.label}</span>
              </Link>
            );
          })
        )}
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

/* ─── User-saved view row with delete-on-hover ─────────────────── */

interface UserSavedViewLinkProps {
  view: SavedViewRecord;
  onTicketsRevamp: boolean;
  searchParams: URLSearchParams;
}

function UserSavedViewLink({ view, onTicketsRevamp, searchParams }: UserSavedViewLinkProps) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteSavedView(view.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-views'] }),
  });

  const query = filtersToQueryString(view.filters);
  const active = onTicketsRevamp && matchesSearch(searchParams, view.filters);

  return (
    <div
      className="group flex items-center gap-2 px-2 py-1 text-[12px] rounded-[3px] mb-px"
      style={{
        backgroundColor: active ? 'var(--c-accent-tint)' : 'transparent',
        color: active ? 'var(--c-accent)' : 'var(--c-fg-2)',
        fontWeight: active ? 600 : 400,
      }}
    >
      <Link
        to={`/tickets-revamp${query}`}
        className="flex-1 min-w-0 flex items-center gap-2 truncate"
        style={{ color: 'inherit' }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-none"
          style={{ backgroundColor: 'var(--c-fg-5)' }}
        />
        <span className="truncate">{view.name}</span>
      </Link>
      <button
        onClick={() => {
          if (window.confirm(`Delete saved view "${view.name}"?`)) remove.mutate();
        }}
        disabled={remove.isPending}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--c-fg-4)' }}
        aria-label={`Delete ${view.name}`}
        title="Delete view"
      >
        <Icn d={I.x} s={11} />
      </button>
    </div>
  );
}

function filtersToQueryString(filters: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(','));
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      sp.set(k, String(v));
    }
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function matchesSearch(actual: URLSearchParams, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([k, v]) => {
    if (v == null) return true;
    const a = actual.get(k);
    if (Array.isArray(v)) return a === v.join(',');
    return a === String(v);
  });
}
