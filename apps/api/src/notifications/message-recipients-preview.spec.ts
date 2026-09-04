import { ConfigService } from '@nestjs/config';
import { MessageType, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import { EmailQueueService } from './email-queue.service';
import { InAppNotificationsService } from './in-app-notifications.service';
import { NotificationsService } from './notifications.service';
import { OutboxService } from './outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketEmailThreadService } from './ticket-email-thread.service';

/**
 * Card 1.28, 6a — the compose screen's recipient preview.
 *
 * Since card 1.33 a reply is ONE email (To: the requester, Cc: the rest) and
 * card 1.34 removed "Also copied" from the body, so this preview is the only
 * place anyone sees who a message will reach. An agent writes something candid
 * on a termination ticket on the strength of it. A preview that disagrees with
 * the send is therefore worse than no preview at all, which is what the drift
 * test below exists to prevent.
 */

const ACTOR: AuthUser = {
  id: 'u-actor',
  email: 'agent@company.com',
  displayName: 'Ada Agent',
  role: UserRole.AGENT,
} as AuthUser;

function user(overrides: Record<string, unknown>) {
  return {
    id: 'u',
    email: 'someone@company.com',
    displayName: 'Someone',
    role: UserRole.AGENT,
    ...overrides,
  };
}

const REQUESTER = user({
  id: 'u-req',
  email: 'bhavesh.patel@company.com',
  displayName: 'Bhavesh Patel',
  role: UserRole.EMPLOYEE,
});
const ASSIGNEE = user({
  id: 'u-asg',
  email: 'greg.weitzer@company.com',
  displayName: 'Greg Weitzer',
  role: UserRole.AGENT,
});
const FOLLOWER = user({
  id: 'u-fol',
  email: 'dana.whitfield@company.com',
  displayName: 'Dana Whitfield',
  role: UserRole.LEAD,
});
/**
 * Somebody CC'd into the conversation who is NOT staff (card 1.42).
 *
 * The whole public-reply block below now turns on this distinction: the
 * requester and this person are emailed; the AGENT assignee and the LEAD
 * follower are not, because staff read the app. Every test in that block
 * asserts both halves - that this one survives AND that the two staff members
 * are absent - so a re-introduction cannot pass by only half breaking.
 */
const CC_COLLEAGUE = user({
  id: 'u-cc',
  email: 'cc.colleague@company.com',
  displayName: 'Cc Colleague',
  role: UserRole.EMPLOYEE,
});

type TicketShape = {
  requester?: unknown;
  assignee?: unknown;
  followers?: { userId: string; user: unknown }[];
};

describe('previewMessageRecipients', () => {
  let service: NotificationsService;
  let findUnique: jest.Mock;
  let isSuppressed: jest.Mock;

  function buildTicket(overrides: TicketShape = {}) {
    return {
      id: 't-1',
      displayId: 'IS_20260902_007',
      number: 7,
      subject: 'Printer offline',
      status: 'NEW',
      requester: REQUESTER,
      assignee: ASSIGNEE,
      assignedTeam: { id: 'team-it', slug: 'it', name: 'IT' },
      followers: [
        { userId: FOLLOWER.id, user: FOLLOWER },
        { userId: CC_COLLEAGUE.id, user: CC_COLLEAGUE },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    process.env.EMAIL_ALLOWED_DOMAINS = 'company.com';
    findUnique = jest.fn();
    isSuppressed = jest.fn().mockResolvedValue(false);
    const config = {
      get: jest.fn((key: string) =>
        key === 'WEB_APP_URL' ? 'http://localhost:5173' : undefined,
      ),
    };
    service = new NotificationsService(
      { ticket: { findUnique } } as unknown as PrismaService,
      { createEmail: jest.fn() } as unknown as OutboxService,
      { enqueue: jest.fn() } as unknown as EmailQueueService,
      config as unknown as ConfigService,
      {} as InAppNotificationsService,
      {
        getBaseReplyToAddress: jest.fn().mockReturnValue('helpdesk@company.com'),
        recordOutboundEmail: jest.fn(),
      } as unknown as TicketEmailThreadService,
      { isSuppressed } as never,
    );
  });

  afterEach(() => {
    delete process.env.EMAIL_ALLOWED_DOMAINS;
  });

  /**
   * REWRITTEN BY CARD 1.42, and the change is the point.
   *
   * These tests used to assert that the assignee and every follower appeared in
   * Cc. Under card 1.42 a public message emails the people OUTSIDE the system
   * only: the requester on To, the non-staff CC'd people on Cc. Staff get the
   * bell instead - the owner's reasoning was that the reply arrives by email,
   * is pulled onto the ticket, and the assignee reads it there, so the email
   * would tell her something already on her screen.
   *
   * The purpose of the block has NOT changed: the preview must equal the send.
   * Only which send it mirrors has.
   */
  describe('a public reply', () => {
    it('puts the requester in To and the non-staff CCs in Cc, never staff', async () => {
      findUnique.mockResolvedValue(buildTicket());
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        ACTOR,
      );
      expect(preview.emails).toBe(true);
      expect(preview.to).toEqual({ id: 'u-req', name: 'Bhavesh Patel' });
      expect(preview.cc.map((entry) => entry.name)).toEqual(['Cc Colleague']);
      // The negative, asserted explicitly: the AGENT assignee and the LEAD
      // follower are on this ticket and are NOT emailed.
      const everyone = [preview.to, ...preview.cc].map((entry) => entry?.name);
      expect(everyone).not.toContain('Greg Weitzer');
      expect(everyone).not.toContain('Dana Whitfield');
      // Names, never addresses: this renders on a screen a requester may be
      // reading over a shoulder.
      expect(
        JSON.stringify(preview.to) + JSON.stringify(preview.cc),
      ).not.toContain('@');
    });

    it('never lists the agent doing the writing', async () => {
      findUnique.mockResolvedValue(
        buildTicket({
          followers: [
            { userId: CC_COLLEAGUE.id, user: CC_COLLEAGUE },
            {
              userId: ACTOR.id,
              user: user({ id: ACTOR.id, email: ACTOR.email }),
            },
          ],
        }),
      );
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        ACTOR,
      );
      const everyone = [preview.to, ...preview.cc].filter(Boolean);
      expect(everyone.map((entry) => entry!.id)).not.toContain(ACTOR.id);
    });

    it('excludes the REQUESTER when the requester is the one writing', async () => {
      // Card 1.42 §1c, second row: when a requester or a CC'd person replies,
      // the email goes to the OTHER external people and to no staff at all.
      // Nobody had tested this direction before.
      findUnique.mockResolvedValue(buildTicket());
      const preview = await service.previewMessageRecipients('t-1', MessageType.PUBLIC, {
        ...ACTOR,
        id: REQUESTER.id,
        email: REQUESTER.email,
        role: UserRole.EMPLOYEE,
      });
      expect(preview.to).toEqual({ id: 'u-cc', name: 'Cc Colleague' });
      expect(preview.cc).toEqual([]);
    });

    it('offers removal only for someone who is here because they follow it', async () => {
      // Removal unfollows from the ticket. The requester cannot be removed at
      // all - a public reply with no To: is not a thing.
      findUnique.mockResolvedValue(buildTicket());
      const preview = await service.previewMessageRecipients('t-1', MessageType.PUBLIC, {
        ...ACTOR,
        role: UserRole.LEAD,
      });
      const byName = new Map(
        preview.cc.map((entry) => [entry.name, entry.removable]),
      );
      expect(byName.get('Cc Colleague')).toBe(true);
      // The assignee is not merely non-removable now - they are not listed.
      expect(byName.has('Greg Weitzer')).toBe(false);
    });

    it('offers no removal at all to an AGENT, who the endpoint would refuse', async () => {
      // unfollowTicket lets only OWNER, TEAM_ADMIN and LEAD remove someone
      // else. Offering an AGENT the control produced a confirm dialog followed
      // by a silent 403 - found in the browser, not by a test.
      findUnique.mockResolvedValue(buildTicket());
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        ACTOR,
      );
      expect(ACTOR.role).toBe(UserRole.AGENT);
      expect(preview.cc.some((entry) => entry.removable)).toBe(false);
      // ...and the CC'd colleague is still listed. They are reachable; it is
      // only the removal that is not this person's to make.
      expect(preview.cc.map((entry) => entry.name)).toContain('Cc Colleague');
    });

    it.each([
      ['OWNER', UserRole.OWNER],
      ['TEAM_ADMIN', UserRole.TEAM_ADMIN],
      ['LEAD', UserRole.LEAD],
    ])('offers removal to a %s, who may remove others', async (_label, role) => {
      findUnique.mockResolvedValue(buildTicket());
      const preview = await service.previewMessageRecipients('t-1', MessageType.PUBLIC, {
        ...ACTOR,
        role,
      });
      expect(
        preview.cc.find((entry) => entry.name === 'Cc Colleague')?.removable,
      ).toBe(true);
    });

    it('reports an out-of-domain follower as refused, not as a Cc', async () => {
      // The vendor is an EMPLOYEE here, deliberately. Card 1.42 filters staff
      // out BEFORE the outbound guard runs, so a staff-roled fixture would
      // never reach the guard and this test would pass without testing it.
      findUnique.mockResolvedValue(
        buildTicket({
          followers: [
            {
              userId: 'u-ext',
              user: user({
                id: 'u-ext',
                email: 'consultant@vendor.example',
                displayName: 'Ext Consultant',
                role: UserRole.EMPLOYEE,
              }),
            },
          ],
        }),
      );
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        ACTOR,
      );
      expect(preview.cc.map((entry) => entry.name)).not.toContain(
        'Ext Consultant',
      );
      expect(preview.refused).toEqual([
        {
          address: 'consultant@vendor.example',
          reason: 'outside the allowed domains',
        },
      ]);
    });

    it('reports a suppressed address as refused', async () => {
      isSuppressed.mockImplementation(
        async (address: string) => address === CC_COLLEAGUE.email,
      );
      findUnique.mockResolvedValue(buildTicket());
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        ACTOR,
      );
      expect(preview.cc.map((entry) => entry.name)).not.toContain(
        'Cc Colleague',
      );
      expect(preview.refused).toEqual([
        { address: CC_COLLEAGUE.email, reason: 'suppressed after a bounce' },
      ]);
    });

    it('promotes the first surviving recipient when there is no requester', async () => {
      // An intake ticket whose requester never resolved. Mirrors
      // queuePublicReplyEmail: an empty To with only Cc recipients is a spam
      // signal, so somebody has to be promoted - and under card 1.42 the
      // promoted one is the external colleague, not the assignee.
      findUnique.mockResolvedValue(buildTicket({ requester: null }));
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        ACTOR,
      );
      expect(preview.to).toEqual({ id: 'u-cc', name: 'Cc Colleague' });
      expect(preview.cc).toEqual([]);
    });

    it('emails nobody when the only people left are staff', async () => {
      // Card 1.42 §1c: rather than an email with an empty To, queue nothing.
      findUnique.mockResolvedValue(
        buildTicket({
          requester: null,
          followers: [{ userId: FOLLOWER.id, user: FOLLOWER }],
        }),
      );
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        ACTOR,
      );
      expect(preview.to).toBeNull();
      expect(preview.cc).toEqual([]);
    });
  });

  describe('an internal note', () => {
    it('emails nobody and says so', async () => {
      findUnique.mockResolvedValue(buildTicket());
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.INTERNAL,
        ACTOR,
      );
      expect(preview.emails).toBe(false);
      expect(preview.to).toBeNull();
      expect(preview.refused).toEqual([]);
    });

    it('drops the requester, and not merely EMPLOYEEs', async () => {
      // excludeEmployees is a ROLE test, and a requester is not always an
      // EMPLOYEE. A payroll lead raising a ticket about her own pay is staff,
      // so the role test alone kept her in the audience for internal notes
      // written about her - and card 1.36 has just stopped her being able to
      // read them, so notifying her would point at content she cannot open.
      findUnique.mockResolvedValue(
        buildTicket({
          requester: user({
            id: 'u-staff-req',
            email: 'payroll.lead@company.com',
            displayName: 'Priya Lead',
            role: UserRole.LEAD,
          }),
        }),
      );
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.INTERNAL,
        ACTOR,
      );
      expect(preview.cc.map((entry) => entry.name)).not.toContain('Priya Lead');
      expect(preview.cc.map((entry) => entry.name)).toEqual([
        'Greg Weitzer',
        'Dana Whitfield',
      ]);
    });

    it('drops an EMPLOYEE follower too, so it really is staff only', async () => {
      findUnique.mockResolvedValue(
        buildTicket({
          followers: [
            {
              userId: 'u-emp',
              user: user({
                id: 'u-emp',
                email: 'floor.staff@company.com',
                displayName: 'Floor Staff',
                role: UserRole.EMPLOYEE,
              }),
            },
          ],
        }),
      );
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.INTERNAL,
        ACTOR,
      );
      expect(preview.cc.map((entry) => entry.name)).toEqual(['Greg Weitzer']);
    });
  });

  it('returns an empty audience for a ticket that is not there', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      service.previewMessageRecipients('missing', MessageType.PUBLIC, ACTOR),
    ).resolves.toEqual({ to: null, cc: [], refused: [], emails: false });
  });

  describe('the preview cannot drift from the send', () => {
    /**
     * The guarantee card 1.28 exists for, updated by card 1.42 rather than
     * weakened. There are now TWO audience functions, and each path must use
     * the same one as the other for a given message type:
     *
     *   a public message -> emailAudience   (the people outside the system)
     *   an internal note -> buildRecipients (the staff audience, unchanged)
     *
     * This spies on both and runs the send and the preview, comparing which
     * function each reached and with what. `messageAdded` is allowed to fail
     * afterwards on mocks it does not have - by then the call is recorded,
     * which is the only thing under test.
     */
    type Spied = {
      emailAudience: (...args: unknown[]) => unknown[];
      buildRecipients: (...args: unknown[]) => unknown[];
    };

    async function audienceCallsOf(run: () => Promise<unknown>) {
      const emailSpy = jest.spyOn(
        service as unknown as Spied,
        'emailAudience',
      );
      const staffSpy = jest.spyOn(
        service as unknown as Spied,
        'buildRecipients',
      );
      try {
        await run();
      } catch {
        // expected for messageAdded: the send path's mocks are not wired
      }
      const result = {
        email: emailSpy.mock.calls.map((call) => call[1]),
        staff: staffSpy.mock.calls.map((call) => call[1]),
      };
      emailSpy.mockRestore();
      staffSpy.mockRestore();
      return result;
    }

    it('a public reply resolves its email audience the same way on both paths', async () => {
      findUnique.mockResolvedValue(buildTicket());
      const fromSend = await audienceCallsOf(() =>
        service.messageAdded(
          't-1',
          { id: 'm-1', type: MessageType.PUBLIC, body: 'Body' } as never,
          ACTOR,
        ),
      );
      const fromPreview = await audienceCallsOf(() =>
        service.previewMessageRecipients('t-1', MessageType.PUBLIC, ACTOR),
      );
      // Both asked emailAudience, with the same actor.
      expect(fromSend.email).toEqual([ACTOR.id]);
      expect(fromPreview.email).toEqual([ACTOR.id]);
      // And the preview did NOT fall back to the staff audience.
      expect(fromPreview.staff).toEqual([]);
    });

    it('an internal note still asks buildRecipients the same question', async () => {
      findUnique.mockResolvedValue(buildTicket());
      const fromSend = await audienceCallsOf(() =>
        service.messageAdded(
          't-1',
          { id: 'm-1', type: MessageType.INTERNAL, body: 'Body' } as never,
          ACTOR,
        ),
      );
      const fromPreview = await audienceCallsOf(() =>
        service.previewMessageRecipients('t-1', MessageType.INTERNAL, ACTOR),
      );
      expect(fromPreview.staff[0]).toEqual(fromSend.staff[0]);
      expect(fromPreview.email).toEqual([]);
    });
  });
});
