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
      followers: [{ userId: FOLLOWER.id, user: FOLLOWER }],
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

  describe('a public reply', () => {
    it('puts the requester in To and everyone else in Cc, by name', async () => {
      findUnique.mockResolvedValue(buildTicket());
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        ACTOR,
      );
      expect(preview.emails).toBe(true);
      expect(preview.to).toEqual({ id: 'u-req', name: 'Bhavesh Patel' });
      expect(preview.cc.map((entry) => entry.name)).toEqual([
        'Greg Weitzer',
        'Dana Whitfield',
      ]);
      // Names, never addresses: this renders on a screen a requester may be
      // reading over a shoulder.
      expect(JSON.stringify(preview.to) + JSON.stringify(preview.cc)).not.toContain(
        '@',
      );
    });

    it('never lists the agent doing the writing', async () => {
      findUnique.mockResolvedValue(
        buildTicket({
          followers: [
            { userId: FOLLOWER.id, user: FOLLOWER },
            { userId: ACTOR.id, user: user({ id: ACTOR.id, email: ACTOR.email }) },
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

    it('offers removal only for someone who is here because they follow it', async () => {
      // Removal unfollows from the ticket. Unfollowing the assignee would not
      // stop them receiving it, and the requester cannot be removed at all -
      // a public reply with no To: is not a thing.
      findUnique.mockResolvedValue(buildTicket());
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        { ...ACTOR, role: UserRole.LEAD },
      );
      const byName = new Map(
        preview.cc.map((entry) => [entry.name, entry.removable]),
      );
      expect(byName.get('Dana Whitfield')).toBe(true);
      expect(byName.get('Greg Weitzer')).toBe(false);
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
      // ...and the follower is still listed. They are reachable; it is only the
      // removal that is not this person's to make.
      expect(preview.cc.map((entry) => entry.name)).toContain('Dana Whitfield');
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
        preview.cc.find((entry) => entry.name === 'Dana Whitfield')?.removable,
      ).toBe(true);
    });

    it('reports an out-of-domain follower as refused, not as a Cc', async () => {
      findUnique.mockResolvedValue(
        buildTicket({
          followers: [
            {
              userId: 'u-ext',
              user: user({
                id: 'u-ext',
                email: 'consultant@vendor.example',
                displayName: 'Ext Consultant',
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
        async (address: string) => address === FOLLOWER.email,
      );
      findUnique.mockResolvedValue(buildTicket());
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        ACTOR,
      );
      expect(preview.cc.map((entry) => entry.name)).not.toContain(
        'Dana Whitfield',
      );
      expect(preview.refused).toEqual([
        { address: FOLLOWER.email, reason: 'suppressed after a bounce' },
      ]);
    });

    it('promotes the first surviving recipient when there is no requester', async () => {
      // An intake ticket whose requester never resolved. Mirrors
      // queuePublicReplyEmail: an empty To with only Cc recipients is a spam
      // signal, so somebody has to be promoted.
      findUnique.mockResolvedValue(buildTicket({ requester: null }));
      const preview = await service.previewMessageRecipients(
        't-1',
        MessageType.PUBLIC,
        ACTOR,
      );
      expect(preview.to).toEqual({ id: 'u-asg', name: 'Greg Weitzer' });
      expect(preview.cc.map((entry) => entry.name)).toEqual([
        'Dana Whitfield',
      ]);
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
     * Both paths must ask buildRecipients the same question. This spies on it
     * and runs BOTH, comparing the options each passed. messageAdded is allowed
     * to fail afterwards on the mocks it does not have - by then the call has
     * been recorded, which is the only thing under test here.
     */
    async function optionsPassedBy(run: () => Promise<unknown>) {
      const spy = jest.spyOn(
        service as unknown as {
          buildRecipients: (...args: unknown[]) => unknown[];
        },
        'buildRecipients',
      );
      try {
        await run();
      } catch {
        // expected for messageAdded: the send path's mocks are not wired
      }
      expect(spy).toHaveBeenCalled();
      const options = spy.mock.calls[0][1];
      spy.mockRestore();
      return options;
    }

    it.each([
      ['a public reply', MessageType.PUBLIC],
      ['an internal note', MessageType.INTERNAL],
    ])('asks the same question as messageAdded for %s', async (_label, type) => {
      findUnique.mockResolvedValue(buildTicket());
      const fromSend = await optionsPassedBy(() =>
        service.messageAdded(
          't-1',
          { id: 'm-1', type, body: 'Body' } as never,
          ACTOR,
        ),
      );
      const fromPreview = await optionsPassedBy(() =>
        service.previewMessageRecipients('t-1', type, ACTOR),
      );
      expect(fromPreview).toEqual(fromSend);
    });
  });
});
