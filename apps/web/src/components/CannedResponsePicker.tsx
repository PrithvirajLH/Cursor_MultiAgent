import { useEffect, useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { fetchCannedResponses, type CannedResponseRecord } from '../api/client';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

export type CannedResponsePickerProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
  variables: {
    ticketId?: string;
    ticketSubject?: string;
    requesterName?: string;
  };
  className?: string;
};

function substituteVariables(content: string, vars: CannedResponsePickerProps['variables']): string {
  let out = content;
  if (vars.ticketId) out = out.replace(/\{\{ticket\.id\}\}/g, vars.ticketId);
  if (vars.ticketSubject) out = out.replace(/\{\{ticket\.subject\}\}/g, vars.ticketSubject);
  if (vars.requesterName) out = out.replace(/\{\{requester\.name\}\}/g, vars.requesterName);
  out = out.replace(/\{\{[^}]+\}\}/g, '');
  return out;
}

export function CannedResponsePicker({
  open,
  onClose,
  onSelect,
  variables,
  className = '',
}: CannedResponsePickerProps) {
  const [list, setList] = useState<CannedResponseRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocusTrap({ open, containerRef: dialogRef, onClose });

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetchCannedResponses()
      .then((data) => setList(Array.isArray(data) ? data : []))
      .catch(() => {
        setError('Failed to load templates');
        setList([]);
      })
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/20"
        aria-hidden
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className={`fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white shadow-xl ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label="Insert canned response"
        tabIndex={-1}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Insert template</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-72 overflow-auto p-2">
          {loading && (
            <p className="py-4 text-center text-sm text-slate-500">Loading…</p>
          )}
          {error && (
            <p className="py-4 text-center text-sm text-red-600">{error}</p>
          )}
          {!loading && !error && list.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-500">No templates saved.</p>
          )}
          {!loading && !error && list.length > 0 && (
            <ul className="space-y-1">
              {list.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const content = substituteVariables(item.content, variables);
                      onSelect(content);
                      onClose();
                    }}
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{item.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{item.content.slice(0, 80)}{item.content.length > 80 ? '…' : ''}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
