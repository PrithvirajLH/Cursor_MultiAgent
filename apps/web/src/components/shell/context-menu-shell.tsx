import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { contextMenuPosition } from "./context-menu-position";
import { getUiZoom } from "../../utils/uiZoom";

/**
 * The behaviour every context menu in this app shares.
 *
 * ⚠️ EXTRACTED, NOT COPIED, AND THAT IS THE POINT OF THIS FILE. Card 1.73 added
 * a second right-click menu — on a conversation message — and the easy route was
 * to duplicate `TicketContextMenu`. Two menus that must stay consistent is the
 * drift behind cards 1.36, 1.38, 1.47, 1.50, 1.66 and 1.71, and it would have
 * been the sixth time. The ticket menu now renders through this shell and keeps
 * its own items; the message menu does the same.
 *
 * What lives here is exactly what was already solved once and is easy to get
 * subtly wrong a second time:
 *
 *  - portal rendering, so the menu escapes any `overflow: hidden` ancestor
 *  - dismissal on outside mousedown and on Escape
 *  - focus moved to the first item on open, so a keyboard user lands inside
 *  - roving Arrow focus across whatever items are currently visible
 *  - zoom-aware placement (see `contextMenuPosition`)
 *
 * ⚠️ What does NOT live here is what each menu means: its items, its header,
 * and any submenu state. A shell that knew about tickets could not serve
 * messages, which is how the duplicate would have crept back.
 */
export function ContextMenuShell({
  x,
  y,
  ariaLabel,
  onClose,
  onKeyDown,
  menuHeight = 360,
  menuWidth = 250,
  widthClass = "w-56",
  children,
}: {
  x: number;
  y: number;
  ariaLabel: string;
  onClose: () => void;
  /** Extra key handling for menus with submenus; Arrow keys are handled here. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Estimated extent, used only to keep the menu on screen. */
  menuHeight?: number;
  menuWidth?: number;
  widthClass?: string;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Focus the first menu item on open so keyboard users land inside the menu.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]',
    );
    first?.focus();
  }, []);

  // ArrowUp/ArrowDown move focus between the currently-visible menu items
  // (roving focus). Submenu options become focusable once expanded.
  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      currentIndex < 0
        ? event.key === "ArrowDown"
          ? 0
          : items.length - 1
        : (currentIndex + delta + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  const { top, left } = contextMenuPosition({
    x,
    y,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    zoom: getUiZoom(),
    menuHeight,
    menuWidth,
  });

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={handleMenuKeyDown}
      style={{ position: "fixed", top, left, zIndex: 100 }}
      className={`flex max-h-[calc(80vh/var(--ui-zoom))] ${widthClass} flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-popover/95 p-1.5 shadow-xl backdrop-blur-md animate-fade-in origin-top-left`}
    >
      {children}
    </div>,
    document.body,
  );
}
