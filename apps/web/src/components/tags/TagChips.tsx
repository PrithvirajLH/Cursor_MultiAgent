import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Plus, Sparkles, Tag as TagIcon, X } from "lucide-react";
import {
  addTagToTicket,
  fetchTagAutocomplete,
  removeTagFromTicket,
  type TagAutocompleteEntry,
  type TagRef,
} from "../../api/client";

type Props = {
  ticketId: string;
  tags: TagRef[];
  canEdit: boolean;
  onChange?: (tags: TagRef[]) => void;
};

export function TagChips({ ticketId, tags, canEdit, onChange }: Props) {
  const [local, setLocal] = useState<TagRef[]>(tags);
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<TagAutocompleteEntry[]>([]);
  const [loadingAutocomplete, setLoadingAutocomplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Compute portal coordinates from the input's bounding rect whenever the
  // popover opens or the layout changes.
  useLayoutEffect(() => {
    if (!adding) {
      setDropdownPos(null);
      return;
    }
    const update = () => {
      const el = inputRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: 224, // matches w-56 below
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [adding, input]);

  // keep local in sync if prop tags change (e.g. detail re-fetch)
  useEffect(() => {
    setLocal(tags);
  }, [tags]);

  useEffect(() => {
    if (!adding) return;
    inputRef.current?.focus();
  }, [adding]);

  // Close on outside click — but the dropdown is rendered through a portal
  // so it's NOT inside containerRef; we need to also check dropdownRef.
  useEffect(() => {
    if (!adding) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const insideAnchor = containerRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideAnchor && !insideDropdown) {
        setAdding(false);
        setInput("");
        setSuggestions([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [adding]);

  // Debounced autocomplete
  useEffect(() => {
    if (!adding) return;
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setLoadingAutocomplete(true);
      try {
        const data = await fetchTagAutocomplete(input.trim() || undefined, 10);
        if (cancelled) return;
        setSuggestions(data);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoadingAutocomplete(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [input, adding]);

  const localById = useMemo(
    () => new Set(local.map((t) => t.id)),
    [local],
  );
  const filteredSuggestions = useMemo(
    () => suggestions.filter((s) => !localById.has(s.id)),
    [suggestions, localById],
  );

  const commitAdd = useCallback(
    async (name: string) => {
      const trimmed = name.trim().toLowerCase();
      if (!trimmed) return;
      setError(null);
      try {
        const created = await addTagToTicket(ticketId, trimmed);
        const next = local.some((t) => t.id === created.id)
          ? local
          : [...local, { ...created, source: "MANUAL" as const }];
        setLocal(next);
        onChange?.(next);
        setInput("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add tag");
      }
    },
    [ticketId, local, onChange],
  );

  const handleRemove = useCallback(
    async (tagId: string) => {
      const prev = local;
      const next = prev.filter((t) => t.id !== tagId);
      setLocal(next); // optimistic
      onChange?.(next);
      try {
        await removeTagFromTicket(ticketId, tagId);
      } catch (err) {
        setLocal(prev); // rollback
        onChange?.(prev);
        setError(err instanceof Error ? err.message : "Failed to remove tag");
      }
    },
    [ticketId, local, onChange],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitAdd(input);
    } else if (event.key === "Escape") {
      setAdding(false);
      setInput("");
      setSuggestions([]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" ref={containerRef}>
      {local.length === 0 && !adding ? (
        <span className="text-xs text-muted-foreground">No tags</span>
      ) : null}

      {local.map((tag) => (
        <span
          key={tag.id}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            tag.source === "AI"
              ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300"
              : "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300"
          }`}
          title={
            tag.source === "AI"
              ? "Tag suggested by AI classification"
              : "Manually added tag"
          }
        >
          {tag.source === "AI" ? (
            <Sparkles className="h-3 w-3" />
          ) : (
            <TagIcon className="h-3 w-3" />
          )}
          <span>{tag.name}</span>
          {canEdit ? (
            <button
              type="button"
              onClick={() => void handleRemove(tag.id)}
              className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-foreground/10"
              aria-label={`Remove ${tag.name}`}
              title={`Remove ${tag.name}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          ) : null}
        </span>
      ))}

      {canEdit && !adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
          <span>Tag</span>
        </button>
      ) : null}

      {canEdit && adding ? (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.toLowerCase())}
            onKeyDown={handleKeyDown}
            placeholder="type to add or pick…"
            className="w-44 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] focus:border-primary focus:outline-none"
            maxLength={50}
          />
          {dropdownPos &&
            (filteredSuggestions.length > 0 ||
              loadingAutocomplete ||
              input.trim().length > 0) &&
            createPortal(
              <div
                ref={dropdownRef}
                className="fixed z-[60] rounded-lg border border-border bg-card shadow-lg"
                style={{
                  top: dropdownPos.top,
                  left: dropdownPos.left,
                  width: dropdownPos.width,
                }}
              >
                {loadingAutocomplete && (
                  <div className="px-3 py-1.5 text-[11px] text-muted-foreground">
                    Searching…
                  </div>
                )}
                {!loadingAutocomplete &&
                  filteredSuggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-accent"
                      onClick={() => void commitAdd(s.name)}
                    >
                      <span>{s.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {s.ticketCount}
                      </span>
                    </button>
                  ))}
                {!loadingAutocomplete &&
                  input.trim().length > 0 &&
                  !filteredSuggestions.some(
                    (s) => s.name === input.trim().toLowerCase(),
                  ) && (
                    <button
                      type="button"
                      onClick={() => void commitAdd(input)}
                      className="flex w-full items-center gap-1.5 border-t border-border px-3 py-1.5 text-left text-[12px] text-primary hover:bg-accent"
                    >
                      <Plus className="h-3 w-3" />
                      Create &quot;{input.trim().toLowerCase()}&quot;
                    </button>
                  )}
              </div>,
              document.body,
            )}
        </div>
      ) : null}

      {error ? (
        <span className="text-[10px] text-red-600">{error}</span>
      ) : null}
    </div>
  );
}
