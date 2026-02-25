import { useEffect, useRef } from 'react';
import { UserPlus, Activity, ArrowUpCircle, Copy } from 'lucide-react';
import type { TicketRecord } from '../api/client';
import { formatTicketId } from '../utils/format';

export type TicketContextMenuProps = {
    x: number;
    y: number;
    ticket: TicketRecord;
    onClose: () => void;
    onAction: (action: 'assign_me' | 'status' | 'priority' | 'copy', ticket: TicketRecord) => void;
};

export function TicketContextMenu({
    x,
    y,
    ticket,
    onClose,
    onAction,
}: TicketContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                onClose();
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const style: React.CSSProperties = {
        position: 'fixed',
        top: Math.min(y, window.innerHeight - 200),
        left: Math.min(x, window.innerWidth - 250),
        zIndex: 100,
    };

    return (
        <div
            ref={menuRef}
            style={style}
            className="w-56 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-md animate-fade-in origin-top-left flex flex-col gap-0.5"
        >
            <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 border-b border-slate-100 mb-1 truncate">
                {formatTicketId(ticket)}
            </div>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAction('assign_me', ticket); onClose(); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors text-left"
            >
                <UserPlus className="h-4 w-4 text-slate-400 shrink-0" />
                Assign to Me
            </button>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAction('status', ticket); onClose(); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors text-left"
            >
                <Activity className="h-4 w-4 text-slate-400 shrink-0" />
                Change Status
            </button>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAction('priority', ticket); onClose(); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors text-left"
            >
                <ArrowUpCircle className="h-4 w-4 text-slate-400 shrink-0" />
                Change Priority
            </button>
            <div className="my-0.5 border-b border-slate-100" />
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAction('copy', ticket); onClose(); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors text-left"
            >
                <Copy className="h-4 w-4 text-slate-400 shrink-0" />
                Copy Ticket ID
            </button>
        </div>
    );
}
