import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchTicketById } from '../api/client';
import { AppSidebar } from '../components/shell/AppSidebar';
import { AppTopbar } from '../components/shell/AppTopbar';
import { Icn, I } from '../components/atoms';

/**
 * Master-detail layout per the design hand-off:
 *   AppSidebar (224) | MidList (280) | Conversation (flex) | Properties (290)
 *
 * Built incrementally — each pane is its own component. Composes existing
 * shell + atoms + ticket-fetch hooks. Wired at /tickets-revamp/:id.
 */
export default function TicketDetailRevamp() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: ticket, isLoading, isError } = useQuery({
    queryKey: ['ticket-detail-revamp', id],
    queryFn: () => fetchTicketById(id!),
    enabled: !!id,
  });

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
            <div className="p-3 text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
              Mid-list pane (P2.2.2)
            </div>
          </aside>

          <main
            className="flex-1 flex flex-col min-w-0 overflow-hidden"
            style={{ backgroundColor: 'var(--c-surface)' }}
          >
            {isLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[13px]" style={{ color: 'var(--c-fg-4)' }}>
                <Icn d={I.clock} s={20} />
                <span>Loading ticket…</span>
              </div>
            ) : isError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[13px]" style={{ color: 'var(--c-fg-3)' }}>
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
              </div>
            ) : ticket ? (
              <div className="p-3 text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
                Conversation pane (P2.2.3) — currently showing: {ticket.subject}
              </div>
            ) : null}
          </main>

          <aside
            className="w-[290px] flex-none border-l overflow-auto"
            style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
          >
            <div className="p-3 text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
              Properties pane (P2.2.4)
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
