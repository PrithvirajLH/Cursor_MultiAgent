import { fillTemplateVars } from '../automation/template-vars.util';
import { buildMacroVars } from './build-macro-vars.util';

/**
 * Card 1.7 §4/§5 — the macro placeholders, and what they must never do.
 *
 * These run through `fillTemplateVars`, the SAME function the rule engine's
 * emails use, on purpose. A second templating function would drift and the
 * drifting one would be the one facing requesters — which had already happened
 * once, in `CannedResponsePicker.tsx`.
 */
describe('macro variables', () => {
  const TICKET = { displayId: 'IS_20260904_010', subject: 'VPN keeps dropping' };
  const REQUESTER = {
    displayName: 'Bhavesh Patel',
    email: 'bhavesh.patel@company.com',
  };
  const ACTOR = { displayName: 'Ada Agent', email: 'ada@company.com' };

  const fill = (
    text: string,
    over: Partial<{
      requester: { displayName?: string | null; email?: string | null } | null;
      actor: { displayName?: string | null; email?: string | null };
    }> = {},
  ) =>
    fillTemplateVars(
      text,
      buildMacroVars({
        ticket: TICKET,
        requester: 'requester' in over ? (over.requester ?? null) : REQUESTER,
        actor: over.actor ?? ACTOR,
      }),
    );

  describe('every variable card 1.7 names', () => {
    it('fills all five', () => {
      const out = fill(
        'Hi {{requester.firstName}} ({{requester.displayName}}), ' +
          'ticket {{ticket.displayId}} about "{{ticket.subject}}" — {{agent.firstName}}',
      );
      expect(out).toBe(
        'Hi Bhavesh (Bhavesh Patel), ticket IS_20260904_010 about "VPN keeps dropping" — Ada',
      );
    });

    it('keeps the two older web-side keys working', () => {
      // Templates written against CannedResponsePicker's own substitution used
      // these names. Dropping them would have silently emptied existing
      // templates; `ticket.id` interpolated a raw UUID before, which is
      // useless in a reply, so it now resolves to the reference people quote.
      expect(fill('{{ticket.id}} / {{requester.name}}')).toBe(
        'IS_20260904_010 / Bhavesh Patel',
      );
    });
  });

  describe('an unknown variable', () => {
    it('becomes nothing, never a raw placeholder', () => {
      const out = fill('Hello {{requester.nickname}}, your {{nonsense}} is done.');
      expect(out).toBe('Hello , your  is done.');
      expect(out).not.toContain('{{');
      expect(out).not.toContain('}}');
    });
  });

  describe('a requester with no name', () => {
    it('falls back to the address local part rather than an empty greeting', () => {
      expect(
        fill('Hi {{requester.firstName}},', {
          requester: { displayName: null, email: 'dana.w@company.com' },
        }),
      ).toBe('Hi dana.w,');
    });

    it('falls back to "there" when there is no name and no address', () => {
      // "Hi ," is a broken sentence in front of a customer. This is the case
      // §5 asks about.
      expect(
        fill('Hi {{requester.firstName}},', {
          requester: { displayName: '   ', email: null },
        }),
      ).toBe('Hi there,');
    });

    it('does the same when there is no requester at all', () => {
      expect(fill('Hi {{requester.displayName}},', { requester: null })).toBe(
        'Hi there,',
      );
    });
  });

  describe('a hostile display name', () => {
    it('is inserted literally, never executed', () => {
      const out = fill('Hi {{requester.firstName}},', {
        requester: { displayName: `<script>alert('x')</script>`, email: null },
      });
      // Not escaped HERE on purpose - the message pipeline escapes at render
      // time and escaping twice would show a requester `&amp;`. What matters
      // is that nothing evaluated it.
      expect(out).toBe(`Hi <script>alert('x')</script>,`);
    });

    it('CANNOT inject another placeholder — substitution is not recursive', () => {
      // The assertion §5 asks for. `fillTemplateVars` makes ONE pass with
      // String.replace, and a replacement is never rescanned, so a name
      // containing a placeholder stays inert text rather than expanding into
      // the ticket subject.
      const out = fill('Hi {{requester.firstName}},', {
        requester: { displayName: '{{ticket.subject}}', email: null },
      });
      expect(out).toBe('Hi {{ticket.subject}},');
      expect(out).not.toContain('VPN keeps dropping');
    });

    it('cannot smuggle a second level through the agent name either', () => {
      const out = fill('— {{agent.firstName}}', {
        actor: { displayName: '{{requester.displayName}}', email: null },
      });
      expect(out).toBe('— {{requester.displayName}}');
      expect(out).not.toContain('Bhavesh');
    });
  });

  describe('a ticket with no display id', () => {
    it('yields an empty reference rather than the word null', () => {
      const out = fillTemplateVars(
        'Ref {{ticket.displayId}}.',
        buildMacroVars({
          ticket: { displayId: null, subject: 'x' },
          requester: REQUESTER,
          actor: ACTOR,
        }),
      );
      expect(out).toBe('Ref .');
      expect(out).not.toContain('null');
    });
  });
});
