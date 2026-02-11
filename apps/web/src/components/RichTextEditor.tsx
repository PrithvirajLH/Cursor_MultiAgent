import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Bold, Italic, List, ListOrdered, Code, Link2, FileText } from 'lucide-react';
import type { UserRef } from '../api/client';
import { MentionAutocomplete } from './MentionAutocomplete';
import { CannedResponsePicker } from './CannedResponsePicker';
import { normalizeDivToP } from '../utils/messageBody';
import DOMPurify from 'dompurify';

// Note: getValue() reads the current DOM and sanitizes immediately. Use this for "Send" so we never
// send stale state when onChange is debounced.
export type RichTextEditorRef = { focus: () => void; getValue: () => string };

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'blockquote', 'span'];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'data-user-id'];

/** Sanitize HTML for storage (keep data-user-id for mentions). Normalizes <div> to <p> so contentEditable line breaks are preserved. */
function sanitizeEditorHtml(html: string): string {
  return DOMPurify.sanitize(normalizeDivToP(html), { ALLOWED_TAGS, ALLOWED_ATTR, ADD_ATTR: ['target'] });
}

/** Get character offset of cursor from start of editable. */
function getCursorOffset(editable: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.setStart(editable, 0);
  return range.toString().length;
}

/** Get text from start of editable to cursor. */
function getTextBeforeCursor(editable: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  const range = sel.getRangeAt(0).cloneRange();
  range.setStart(editable, 0);
  range.setEnd(sel.anchorNode!, sel.anchorOffset);
  return range.toString();
}

/** Find node and offset at character index (for setting range start at @). */
function getNodeAtOffset(root: Node, targetOffset: number): { node: Node; offset: number } | null {
  let offset = 0;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node: Node | null;
  while ((node = walk.nextNode())) {
    const len = (node.textContent || '').length;
    if (offset + len >= targetOffset) {
      return { node, offset: targetOffset - offset };
    }
    offset += len;
  }
  return { node: root, offset: 0 };
}

/** Create a range from character start to end within editable. */
function createRange(editable: HTMLElement, startOffset: number, endOffset: number): Range | null {
  const start = getNodeAtOffset(editable, startOffset);
  const end = getNodeAtOffset(editable, endOffset);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

const EMPTY_HTML = '<br>';

type RichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  users: UserRef[];
  cannedVariables: { ticketId?: string; ticketSubject?: string; requesterName?: string };
  minRows?: number;
  maxRows?: number;
  className?: string;
};

export const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(function RichTextEditor(
  {
    value,
    onChange,
    placeholder = 'Write a reply…',
    users,
    cannedVariables,
    minRows = 2,
    maxRows = 12,
    className = '',
  },
  ref,
) {
  const editableRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  /** Last HTML we sent via onChange; skip syncing value→DOM when prop equals this (avoids wiping selection). */
  const lastSentHtmlRef = useRef<string>('');
  const flushTimerRef = useRef<number | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionAtOffset, setMentionAtOffset] = useState<number | null>(null);
  const [showCanned, setShowCanned] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        editableRef.current?.focus();
      },
      getValue() {
        // If a debounced flush is pending, cancel it so we don't resurrect cleared content after Send.
        if (flushTimerRef.current != null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        const el = editableRef.current;
        if (!el) return '';
        const html = el.innerHTML;
        if (html === EMPTY_HTML || html.trim() === '<br>') return '';
        return sanitizeEditorHtml(html);
      },
    }),
    [],
  );

  const filteredUsers = useMemo(() => {
    if (!mentionQuery.trim()) return users.slice(0, 10);
    const q = mentionQuery.toLowerCase();
    return users
      .filter(
        (u) =>
          u.displayName?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [users, mentionQuery]);

  const syncValueToEditable = useCallback(() => {
    const el = editableRef.current;
    if (!el) return;
    const isEmpty = value.trim() === '';
    // When parent clears (e.g. after send), always sync so the editor empties.
    if (isEmpty) {
      // Cancel pending debounced flush so it can't re-populate cleared state.
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      lastSentHtmlRef.current = value;
      el.innerHTML = EMPTY_HTML;
      return;
    }
    // Don't overwrite DOM when value is just our own last onChange (preserves cursor/selection and inline formatting).
    if (value === lastSentHtmlRef.current) return;
    lastSentHtmlRef.current = value;
    el.innerHTML = value;
  }, [value]);

  useEffect(() => {
    syncValueToEditable();
  }, [value, syncValueToEditable]);

  const getHtml = useCallback((): string => {
    const el = editableRef.current;
    if (!el) return '';
    const html = el.innerHTML;
    if (html === EMPTY_HTML || html.trim() === '<br>') return '';
    return sanitizeEditorHtml(html);
  }, []);

  const flushToParent = useCallback(() => {
    const el = editableRef.current;
    if (!el) return;
    const html = el.innerHTML;
    const sanitized = html === EMPTY_HTML || html.trim() === '<br>' ? '' : sanitizeEditorHtml(html);
    lastSentHtmlRef.current = sanitized;
    onChange(sanitized);
  }, [onChange]);

  const handleInput = useCallback(() => {
    const el = editableRef.current;
    if (!el) return;

    // Debounce sanitization + parent state updates to reduce main-thread work while typing.
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushToParent();
    }, 150);

    const textBefore = getTextBeforeCursor(el);
    const lastAt = textBefore.lastIndexOf('@');
    if (lastAt === -1) {
      setShowMentions(false);
      return;
    }
    const afterAt = textBefore.slice(lastAt + 1);
    if (/\s/.test(afterAt) || afterAt.includes('@')) {
      setShowMentions(false);
      return;
    }
    setShowMentions(true);
    setMentionQuery(afterAt);
    setMentionAtOffset(lastAt);
    setMentionIndex(0);
  }, [flushToParent]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  const selectMention = useCallback(
    (user: UserRef) => {
      const el = editableRef.current;
      if (!el || mentionAtOffset === null) return;
      const cursorOffset = getCursorOffset(el);
      const range = createRange(el, mentionAtOffset, cursorOffset);
      if (!range) {
        setShowMentions(false);
        setMentionAtOffset(null);
        return;
      }
      const span = document.createElement('span');
      span.className = 'mention';
      span.setAttribute('data-user-id', user.id);
      span.contentEditable = 'false';
      span.textContent = `@${user.displayName || user.email}`;
      const sel = window.getSelection();
      if (sel) {
        range.deleteContents();
        range.insertNode(span);
        range.collapse(false);
        const space = document.createTextNode('\u00A0');
        range.insertNode(space);
        range.setStartAfter(space);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      el.focus();
      const newHtml = getHtml();
      lastSentHtmlRef.current = newHtml;
      onChange(newHtml);
      setShowMentions(false);
      setMentionAtOffset(null);
      setMentionQuery('');
    },
    [mentionAtOffset, onChange, getHtml],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showMentions && filteredUsers.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % filteredUsers.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) => (i - 1 + filteredUsers.length) % filteredUsers.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const user = filteredUsers[mentionIndex];
          if (user) selectMention(user);
          return;
        }
        if (e.key === 'Escape') {
          setShowMentions(false);
          return;
        }
      }
    },
    [showMentions, filteredUsers, mentionIndex, selectMention],
  );

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editableRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const el = editableRef.current;
    const saved = savedRangeRef.current;
    if (!el || !saved) return;
    try {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(saved);
      }
      el.focus();
    } catch {
      savedRangeRef.current = null;
    }
  }, []);

  const execCmd = useCallback((command: string, value?: string) => {
    saveSelection();
    requestAnimationFrame(() => {
      restoreSelection();
      document.execCommand(command, false, value);
      editableRef.current?.focus();
      const html = getHtml();
      lastSentHtmlRef.current = html;
      onChange(html);
    });
  }, [saveSelection, restoreSelection, getHtml, onChange]);

  const handleToolbarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    saveSelection();
  }, [saveSelection]);

  const handleCannedSelect = useCallback(
    (content: string) => {
      restoreSelection();
      const html = sanitizeEditorHtml(content);
      document.execCommand('insertHTML', false, html);
      const newHtml = getHtml();
      lastSentHtmlRef.current = newHtml;
      onChange(newHtml);
      setShowCanned(false);
    },
    [restoreSelection, getHtml, onChange],
  );

  const mentionPosition = useMemo(() => {
    if (!showMentions || !editableRef.current) return null;
    const rect = editableRef.current.getBoundingClientRect();
    return { top: rect.bottom + 4, left: rect.left };
  }, [showMentions]);

  const isEmpty = value.trim() === '' || value === '<br>';

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50/80 px-2 py-1">
        <button
          type="button"
          onMouseDown={handleToolbarMouseDown}
          onClick={() => execCmd('bold')}
          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
          title="Bold"
          aria-label="Bold"
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={handleToolbarMouseDown}
          onClick={() => execCmd('italic')}
          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
          title="Italic"
          aria-label="Italic"
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={handleToolbarMouseDown}
          onClick={() => execCmd('insertUnorderedList')}
          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
          title="Bullet list"
          aria-label="Bullet list"
        >
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={handleToolbarMouseDown}
          onClick={() => execCmd('insertOrderedList')}
          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
          title="Numbered list"
          aria-label="Numbered list"
        >
          <ListOrdered className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={handleToolbarMouseDown}
          onClick={() => execCmd('formatBlock', 'pre')}
          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
          title="Code block"
          aria-label="Code block"
        >
          <Code className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={handleToolbarMouseDown}
          onClick={() => {
            const url = window.prompt('Link URL:', 'https://');
            if (url) execCmd('createLink', url);
          }}
          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
          title="Link"
          aria-label="Link"
        >
          <Link2 className="h-4 w-4" />
        </button>
        <div className="mx-1 w-px bg-slate-200" />
        <button
          type="button"
          onClick={() => setShowCanned(true)}
          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
          title="Insert template"
          aria-label="Insert template"
        >
          <FileText className="h-4 w-4" />
        </button>
      </div>

      <div className="relative border border-t-0 border-slate-200 bg-white">
        {isEmpty && (
          <div
            className="pointer-events-none absolute left-3 top-3 text-sm text-slate-400"
            aria-hidden
          >
            {placeholder}
          </div>
        )}
        <div
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          className="min-h-[80px] max-h-[288px] overflow-y-auto p-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:ring-inset"
          style={{ minHeight: `${minRows * 24}px`, maxHeight: `${maxRows * 24}px` }}
          data-placeholder={placeholder}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
      </div>

      <MentionAutocomplete
        users={filteredUsers}
        selectedIndex={mentionIndex}
        onSelect={selectMention}
        position={mentionPosition}
      />

      <CannedResponsePicker
        open={showCanned}
        onClose={() => setShowCanned(false)}
        onSelect={handleCannedSelect}
        variables={cannedVariables}
      />
    </div>
  );
});
