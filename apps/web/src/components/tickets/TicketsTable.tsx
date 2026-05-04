import { useState } from 'react';
import { Pill, Prio, Avatar, SlaBar, Icn, I } from '../atoms';
import type { TicketRow } from './mappers';
import type { SortField, SortOrder } from '../../types';

interface TicketsTableProps {
  tickets: TicketRow[];
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onRowClick?: (id: string) => void;
  sort?: SortField;
  order?: SortOrder;
  onSortChange?: (sort: SortField, order: SortOrder) => void;
}

export function TicketsTable({
  tickets,
  selected,
  onSelectionChange,
  onRowClick,
  sort,
  order,
  onSortChange,
}: TicketsTableProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const allChecked = tickets.length > 0 && tickets.every(t => selected.has(t.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const toggleAll = () => {
    if (allChecked) onSelectionChange(new Set());
    else onSelectionChange(new Set(tickets.map(t => t.id)));
  };

  const headStyle = { color: 'var(--c-fg-4)', backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)' };

  return (
    <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--c-surface)' }}>
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ ...headStyle, width: 28 }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
            </th>
            <th className="border-b sticky top-0" style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 18 }} />
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ ...headStyle, width: 88 }}>ID</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={headStyle}>Subject</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ ...headStyle, width: 150 }}>Customer</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ ...headStyle, width: 110 }}>Status</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ ...headStyle, width: 90 }}>Team</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ ...headStyle, width: 88 }}>Assignee</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ ...headStyle, width: 140 }}>SLA</th>
            <th
              className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0"
              style={{ ...headStyle, width: 70, cursor: onSortChange ? 'pointer' : 'default' }}
              onClick={() => {
                if (!onSortChange) return;
                if (sort === 'updatedAt') onSortChange('updatedAt', order === 'asc' ? 'desc' : 'asc');
                else onSortChange('updatedAt', 'desc');
              }}
              aria-sort={sort === 'updatedAt' ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              Updated{sort === 'updatedAt' && (
                <span className="ml-1 font-mono">{order === 'asc' ? '↑' : '↓'}</span>
              )}
            </th>
            <th className="border-b sticky top-0" style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 24 }} />
          </tr>
        </thead>
        <tbody>
          {tickets.map(t => {
            const isSelected = selected.has(t.id);
            const isHover = hovered === t.id;
            const rowBg = isSelected ? 'var(--c-accent-tint)' : isHover ? 'var(--c-surface-2)' : 'transparent';
            const cellStyle = { backgroundColor: rowBg, borderColor: 'var(--c-divider)' };
            return (
              <tr
                key={t.id}
                onMouseEnter={() => setHovered(t.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onRowClick?.(t.id)}
                className="cursor-pointer"
              >
                <td className="py-1.5 px-2.5 border-b" style={cellStyle} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggle(t.id)} aria-label={`Select ${t.displayId}`} />
                </td>
                <td className="py-1.5 px-2.5 border-b" style={cellStyle}>
                  <Prio level={t.priority} />
                </td>
                <td className="py-1.5 px-2.5 border-b font-mono text-[11px]" style={{ ...cellStyle, color: 'var(--c-fg-4)' }}>
                  {t.displayId}
                </td>
                <td className="py-1.5 px-2.5 border-b" style={cellStyle}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate font-medium flex-1" style={{ color: 'var(--c-fg)' }}>{t.subject}</span>
                    {t.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-px rounded-sm flex-none" style={{ backgroundColor: 'var(--c-surface-3)', color: 'var(--c-fg-3)' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-1.5 px-2.5 border-b" style={cellStyle}>
                  <div className="truncate" style={{ maxWidth: 140 }}>{t.customer}</div>
                  <div className="font-mono text-[10px]" style={{ color: 'var(--c-fg-4)' }}>{t.customerId}</div>
                </td>
                <td className="py-1.5 px-2.5 border-b" style={cellStyle}>
                  <Pill tone={t.statusTone} dot>{t.status}</Pill>
                </td>
                <td className="py-1.5 px-2.5 border-b text-[12px]" style={{ ...cellStyle, color: 'var(--c-fg-3)' }}>
                  {t.team}
                </td>
                <td className="py-1.5 px-2.5 border-b" style={cellStyle}>
                  <div className="flex items-center gap-1.5">
                    <Avatar name={t.assigneeInitials} size="sm" tone={t.assigneeTone} />
                    <span className="text-[11px]">@{t.assigneeInitials}</span>
                  </div>
                </td>
                <td className="py-1.5 px-2.5 border-b" style={cellStyle}>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-[60px]"><SlaBar pct={t.sla.pct} state={t.sla.state} /></div>
                    <span
                      className="font-mono text-[11px] font-semibold w-[50px] text-right"
                      style={{
                        color:
                          t.sla.state === 'breach' ? 'var(--c-red)' :
                          t.sla.state === 'warn'   ? 'var(--c-amber)' :
                                                     'var(--c-fg-3)',
                      }}
                    >{t.sla.text}</span>
                  </div>
                </td>
                <td className="py-1.5 px-2.5 border-b font-mono text-[11px]" style={{ ...cellStyle, color: 'var(--c-fg-4)' }}>
                  {t.updated}
                </td>
                <td className="py-1.5 px-2.5 border-b" style={cellStyle}>
                  <button onClick={e => e.stopPropagation()} aria-label="More actions">
                    <Icn d={I.more} s={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
