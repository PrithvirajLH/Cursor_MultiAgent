import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { contextMenuPosition } from './context-menu-position';

const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TICKET_MENU = codeOnly(
  readFileSync(join(__dirname, '..', 'TicketContextMenu.tsx'), 'utf8'),
);
const SHELL = codeOnly(
  readFileSync(join(__dirname, 'context-menu-shell.tsx'), 'utf8'),
);
const MESSAGE_MENU = codeOnly(
  readFileSync(
    join(__dirname, '..', 'ticket-detail', 'MessageContextMenu.tsx'),
    'utf8',
  ),
);

/**
 * Card 1.73 — the context-menu shell, extracted rather than copied.
 *
 * The app already right-clicked in three places, all into `TicketContextMenu`.
 * Adding a fourth surface (a conversation message) by copying that component
 * would have been the sixth instance of the two-things-that-must-agree shape
 * behind cards 1.36, 1.38, 1.47, 1.50, 1.66 and 1.71.
 *
 * ⚠️ THE DEFINITIVE PROOF THAT THE TICKET MENU DID NOT CHANGE IS THE BROWSER
 * PASS, and it is stated plainly rather than implied: this suite runs in a node
 * environment with no jsdom and no testing-library, so the component cannot be
 * mounted and its dismissal cannot be exercised here. What these assertions can
 * do is pin the things a refactor would silently alter — the placement
 * arithmetic, and that the ticket menu no longer carries its own copy of the
 * behaviour.
 */
describe('the extracted context-menu shell (card 1.73)', () => {
  describe('placement', () => {
    it('⚠️ divides by the zoom, which is the easy half to get wrong', () => {
      // x/y are VISUAL coordinates but a fixed element lays out at value*zoom.
      // Forgetting this puts the menu further from the pointer the further down
      // the page you click - a bug reported as "it feels off", never as a bug.
      expect(
        contextMenuPosition({
          x: 400,
          y: 300,
          viewportWidth: 1920,
          viewportHeight: 1080,
          zoom: 2,
          menuHeight: 360,
          menuWidth: 250,
        }),
      ).toEqual({ top: 150, left: 200 });
    });

    it('keeps the menu on screen near the bottom-right edge', () => {
      expect(
        contextMenuPosition({
          x: 1900,
          y: 1070,
          viewportWidth: 1920,
          viewportHeight: 1080,
          zoom: 1,
          menuHeight: 360,
          menuWidth: 250,
        }),
      ).toEqual({ top: 720, left: 1670 });
    });

    it('⚠️ treats a broken zoom as 1 rather than dividing by zero', () => {
      // getUiZoom reads a CSS variable; a missing or malformed value must
      // misplace a menu slightly, never produce Infinity.
      const at = (zoom: number) =>
        contextMenuPosition({
          x: 100,
          y: 100,
          viewportWidth: 1920,
          viewportHeight: 1080,
          zoom,
          menuHeight: 360,
          menuWidth: 250,
        });
      expect(at(0)).toEqual({ top: 100, left: 100 });
      expect(at(-1)).toEqual({ top: 100, left: 100 });
      expect(Number.isFinite(at(0).top)).toBe(true);
    });

    it('⚠️ reproduces the ticket menu’s original numbers exactly', () => {
      // THE ONE THAT WOULD CATCH A CHANGED CLAMP. Before the extraction the
      // ticket menu computed `Math.min(y, innerHeight - 360) / z` and
      // `Math.min(x, innerWidth - 250) / z` inline. The shell's defaults are
      // those same 360 and 250, so the menu opens exactly where it did.
      const legacy = (x: number, y: number, z: number, w: number, h: number) => ({
        top: Math.min(y, h - 360) / z,
        left: Math.min(x, w - 250) / z,
      });
      for (const [x, y, z] of [
        [10, 10, 1],
        [1500, 900, 1],
        [640, 480, 1.25],
      ] as const) {
        expect(
          contextMenuPosition({
            x,
            y,
            viewportWidth: 1920,
            viewportHeight: 1080,
            zoom: z,
            menuHeight: 360,
            menuWidth: 250,
          }),
        ).toEqual(legacy(x, y, z, 1920, 1080));
      }
    });
  });

  describe('the ticket menu no longer owns the behaviour', () => {
    it('⚠️ renders through the shell and keeps no second copy', () => {
      // If the listeners came back here, the two menus would drift - which is
      // the entire reason this card extracted rather than copied.
      expect(TICKET_MENU).toContain('<ContextMenuShell');
      expect(TICKET_MENU).not.toContain('createPortal');
      expect(TICKET_MENU).not.toContain('addEventListener');
      expect(TICKET_MENU).not.toContain('getUiZoom');
    });

    it('keeps its own items, header and submenu state', () => {
      // The shell owns behaviour, not meaning. A shell that knew about tickets
      // could not serve messages, and the duplicate would creep back.
      expect(TICKET_MENU).toContain('Assign to Me');
      expect(TICKET_MENU).toContain('Copy Ticket ID');
      expect(TICKET_MENU).toContain('openSub');
      // Passed to the shell as a prop now, not spelled as a DOM attribute here.
      expect(TICKET_MENU).toContain('ariaLabel="Ticket actions"');
    });

    it('the shell owns exactly the shared behaviour', () => {
      expect(SHELL).toContain('createPortal');
      expect(SHELL).toContain('mousedown');
      expect(SHELL).toContain('Escape');
      expect(SHELL).toContain('ArrowDown');
      // ...and nothing about tickets or messages.
      expect(SHELL).not.toContain('TicketRecord');
      expect(SHELL).not.toContain('Assign to Me');
    });
  });

  describe('the message menu', () => {
    it('⚠️ shares the shell rather than copying it', () => {
      expect(MESSAGE_MENU).toContain('<ContextMenuShell');
      expect(MESSAGE_MENU).not.toContain('createPortal');
      expect(MESSAGE_MENU).not.toContain('addEventListener');
    });

    it('⚠️ carries all four items the owner asked for', () => {
      // Copy text, delivery status, who it went to, Remove. The card allows
      // shipping three and following up, so this records that four shipped -
      // the server half made the recipients real.
      expect(MESSAGE_MENU).toContain('Copy text');
      expect(MESSAGE_MENU).toContain('Sent to');
      expect(MESSAGE_MENU).toContain('deliverySummary');
      expect(MESSAGE_MENU).toContain('Remove');
    });

    it('⚠️ shows a queued email instead of nothing', () => {
      // The half that made the delivery item worth a click: `pending` was
      // returned by the API and dropped by the screen, so a queued message
      // looked exactly like an internal note.
      expect(MESSAGE_MENU).toContain('queued');
      expect(MESSAGE_MENU).toContain('delivery.pending');
    });

    it('⚠️ omits Remove rather than disabling it', () => {
      // A greyed row invites a support question. The guard is the same one the
      // old link used.
      expect(MESSAGE_MENU).toContain('canRemove ?');
      expect(MESSAGE_MENU).not.toContain('disabled');
    });
  });
});
