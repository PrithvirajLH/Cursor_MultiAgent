import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { UserRef } from "../api/client";

export type MentionUser = UserRef;

export function MentionAutocomplete({
  users,
  selectedIndex,
  onSelect,
  position,
  className = "",
}: {
  users: MentionUser[];
  search?: string;
  selectedIndex: number;
  onSelect: (user: MentionUser) => void;
  onClose?: () => void;
  /** Viewport coordinates (e.g. from getBoundingClientRect) for fixed positioning. Rendered in a portal to avoid overflow clipping. */
  position: { top: number; left: number } | null;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const item = el.querySelector(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (position === null || users.length === 0) return null;

  const dropdown = (
    <div
      ref={listRef}
      className={`z-[9999] max-h-48 w-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg ${className}`}
      style={{ position: "fixed", top: position.top, left: position.left }}
      role="listbox"
      aria-label="Mention user"
    >
      {users.map((user, index) => (
        <button
          key={user.id}
          type="button"
          data-index={index}
          role="option"
          aria-selected={index === selectedIndex}
          className={`w-full px-3 py-2 text-left text-sm transition ${
            index === selectedIndex
              ? "bg-slate-100 text-slate-900"
              : "text-slate-700 hover:bg-slate-50"
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(user);
          }}
        >
          <span className="font-medium">{user.displayName}</span>
          <span className="ml-2 text-slate-500 text-xs">{user.email}</span>
        </button>
      ))}
    </div>
  );

  return createPortal(dropdown, document.body);
}
