import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchTicketById } from '../api/client';
import { useAuthSession } from '../hooks/useAuthSession';
import { AppSidebar } from '../components/shell/AppSidebar';
import { AppTopbar } from '../components/shell/AppTopbar';
import { Icn, I } from '../components/atoms';
import { MidList } from '../components/ticket-detail-revamp/MidList';
import { ConversationPane } from '../components/ticket-detail-revamp/ConversationPane';
import { PropertiesPane } from '../components/ticket-detail-revamp/PropertiesPane';
import { useTicketRealtime } from '../components/tickets/use-ticket-realtime';

/**
 * Master-detail layout per the design hand-off:
 *   AppSidebar (224) | MidList (280) | Conversation (flex) | Properties (290)
 *
 * Built incrementally — each pane is its own component. Composes existing
 * shell + atoms + ticket-fetch hooks. Wired at /tickets-revamp/:id.
 */
export default function TicketDetailRevamp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthSession();

  // The bare-render path in App.tsx renders this component outside the legacy
  // <Routes> tree, so `useParams()` returns {}. Parse the id straight from URL.
  const idMatch = location.pathname.match(/^\/tickets-revamp\/([^/?#]+)/);
  const id = idMatch?.[1];

  const { data: ticket, isLoading, isError } = useQuery({
    queryKey: ['ticket-detail-revamp', id],
    queryFn: () => fetchTicketById(id!),
    // Wait for auth — fetchTicketById without a token returns 401.
    enabled: !!id && !!user && !authLoading,
  });

  // Realtime: when any ticket changes (this one or others), invalidate queries.
  // Re-uses the list's hook since the queryKey it invalidates includes detail too.
  useTicketRealtime({ userKey: user?.email });

  return (
    <div
      className="w-full h-screen flex"
      style={{ backgroundColor: 'var(--c-bg)', color: 'var(--c-fg)' }}
    >
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AppTopbar
          crumbs={[
            'Inbox',
            'All open',
            ticket?.displayId ?? (id ? `#${id.slice(0, 8)}` : 'Loading…'),
          ]}
        />

        {/* Three-pane body: mid-list (280) | conversation (flex) | properties (290) */}
        <div className="flex-1 flex min-h-0">
          <aside
            className="w-[280px] flex-none border-r overflow-auto"
            style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
          >
            <MidList currentTicketId={id} />
          </aside>

          {isLoading ? (
            <main
              className="flex-1 flex flex-col items-center justify-center gap-2 text-[13px] min-w-0"
              style={{ backgroundColor: 'var(--c-surface)', color: 'var(--c-fg-4)' }}
            >
              <Icn d={I.clock} s={20} />
              <span>Loading ticket…</span>
            </main>
          ) : isError || !ticket ? (
            <main
              className="flex-1 flex flex-col items-center justify-center gap-2 text-[13px] min-w-0"
              style={{ backgroundColor: 'var(--c-surface)', color: 'var(--c-fg-3)' }}
            >
              <Icn d={I.alert} s={32} />
              <div className="font-semibold" style={{ color: 'var(--c-fg)' }}>
                Couldn't load ticket
              </div>
              <button
                onClick={() => navigate(-1)}
                className="text-[11px] px-2 py-1 rounded border"
                style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)' }}
              >
                Back to list
              </button>
            </main>
          ) : (
            <ConversationPane ticket={ticket} />
          )}

          <aside
            className="w-[290px] flex-none border-l overflow-auto"
            style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
          >
            {ticket ? (
              <PropertiesPane ticket={ticket} />
            ) : (
              <div className="p-3 text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
                {isLoading ? 'Loading…' : '—'}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
