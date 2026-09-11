import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTransientLayerOpen } from './transient-layer';

/**
 * A minimal stand-in for `document.querySelector`.
 *
 * ⚠️ There is no DOM in this suite — it runs in a node environment with no
 * jsdom anywhere in the repo — so the document is stubbed and the assertions are
 * about WHICH SELECTOR the guard asks for. That is the whole of the bug being
 * fixed: the old guard asked a question that was too narrow, and every overlay
 * it missed became a way to navigate the reader off the page by accident.
 */
/**
 * Selectors a real page always matches, open overlay or not.
 *
 * ⚠️ THE FIRST VERSION OF THIS STUB ONLY KNEW ABOUT OVERLAYS, AND THAT MADE
 * THE NON-VACUITY TEST USELESS. Measured: adding `body` to the guard's selector
 * - an over-greedy change that would kill Escape-to-go-back on every press -
 * left all seven tests green, because the stub had never heard of `body`. A
 * stub that cannot represent the page itself cannot catch a guard that matches
 * the page itself.
 */
const ALWAYS_PRESENT = ['body', 'html', 'div', 'main', '*', '[id]'];

function stubDocument(openElements: string[]) {
  const matches = (selector: string) =>
    selector
      .split(',')
      .map((part) => part.trim())
      .some(
        (part) => openElements.includes(part) || ALWAYS_PRESENT.includes(part),
      );
  vi.stubGlobal('document', {
    querySelector: (selector: string) => (matches(selector) ? {} : null),
  });
}

describe('isTransientLayerOpen (card 1.76)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('⚠️ says nothing is open when nothing is open', () => {
    // THE NON-VACUITY TEST, and the one that matters most. Escape-to-go-back is
    // a real feature somebody uses; a guard that is too greedy kills it
    // silently, and every other assertion in this file would still pass. If
    // this returns true with an empty document, the shortcut is dead.
    stubDocument([]);
    expect(isTransientLayerOpen()).toBe(false);
  });

  it('⚠️ catches a context menu, which the old guard did not', () => {
    // The reported bug: the menu renders `role="menu"` and the old selector
    // asked for `[role="dialog"][aria-modal="true"]`, so pressing Escape to
    // dismiss the menu navigated off the ticket.
    stubDocument(['[role="menu"]']);
    expect(isTransientLayerOpen()).toBe(true);
  });

  it('⚠️ catches a NON-modal dialog, which the old guard did not', () => {
    // The four popovers that are deliberately not modal: the notification
    // panel, the profile popover, the save-view popover and the saved-view
    // delete confirmation. None of them traps focus, so none may claim
    // `aria-modal` - labelling them modal would be a false promise to a screen
    // reader and a worse bug than this one.
    stubDocument(['[role="dialog"]']);
    expect(isTransientLayerOpen()).toBe(true);
  });

  it('keeps catching the modal dialogs that already worked', () => {
    // Card 1.11's Remove confirmation and card 1.48's image lightbox were never
    // affected by the bug. A change to the guard must not lose them.
    stubDocument(['[role="dialog"]']);
    expect(isTransientLayerOpen()).toBe(true);
  });

  it('offers an escape hatch for a layer that is neither', () => {
    // For anything that is not a dialog or a menu by role. Deliberately last
    // resort: an opt-in attribute is what the old guard effectively required,
    // and requiring it is how two overlays came to be missed.
    stubDocument(['[data-transient-layer]']);
    expect(isTransientLayerOpen()).toBe(true);
  });

  it('⚠️ asks about all three in one query, not several', () => {
    // A guard that ran three separate queries would be three places to forget.
    const seen: string[] = [];
    vi.stubGlobal('document', {
      querySelector: (selector: string) => {
        seen.push(selector);
        return null;
      },
    });
    isTransientLayerOpen();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('[role="dialog"]');
    expect(seen[0]).toContain('[role="menu"]');
  });

  it('⚠️ does not require aria-modal, which is the whole fix', () => {
    // Pinning the absence: if `[aria-modal="true"]` reappears in the selector,
    // the four non-modal popovers silently become victims again.
    const seen: string[] = [];
    vi.stubGlobal('document', {
      querySelector: (selector: string) => {
        seen.push(selector);
        return null;
      },
    });
    isTransientLayerOpen();
    expect(seen[0]).not.toContain('aria-modal');
  });
});
