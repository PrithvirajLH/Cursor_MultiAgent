/**
 * Detects whether the current platform is macOS so the UI can render the
 * correct modifier-key glyph (⌘ on macOS, Ctrl elsewhere). Label-only — the
 * keyboard handlers already accept both metaKey and ctrlKey.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The primary modifier-key glyph for the current platform. */
export const modKeyLabel = isMac() ? "⌘" : "Ctrl";
