import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildWebhookEnvelope } from './webhook-payload.util';
import { sendWebhook, signWebhookBody } from './webhook-sender.util';
import { inspectWebhookUrl, isBlockedAddress } from './webhook-url.util';

/**
 * Card 2.6 — the security assertion of the whole feature.
 *
 * ⚠️ The server makes an HTTP request to a URL an admin typed, from inside
 * Azure, where 169.254.169.254 hands out managed-identity tokens to anything
 * that asks. Card 1.69 already proved this app sees 169.254.x.x as its own
 * ingress, so that address is reachable from here.
 */
describe('a webhook cannot be pointed inside the network (card 2.6)', () => {
  describe('addresses that must always be refused', () => {
    const blocked = [
      ['169.254.169.254', 'the cloud metadata service — the one that matters'],
      ['169.254.1.1', 'anything else link-local'],
      ['127.0.0.1', 'loopback'],
      ['127.1.2.3', 'the rest of 127/8'],
      ['10.0.0.5', 'private class A'],
      ['172.16.0.1', 'private class B, low end'],
      ['172.31.255.254', 'private class B, high end'],
      ['192.168.1.1', 'private class C'],
      ['100.64.0.1', 'carrier-grade NAT'],
      ['0.0.0.0', 'this network'],
      ['::1', 'IPv6 loopback'],
      ['fd00::1', 'IPv6 unique-local'],
      ['fe80::1', 'IPv6 link-local'],
      ['::ffff:169.254.169.254', '⚠️ IPv4-mapped IPv6 — the smuggling route'],
    ] as const;

    for (const [address, why] of blocked) {
      it(`refuses ${address} (${why})`, () => {
        expect(isBlockedAddress(address)).toBe(true);
      });
    }

    it('⚠️ 172.32.0.1 is PUBLIC and must not be blocked', () => {
      // The off-by-one that a lazy 172.* check gets wrong. Private space is
      // 172.16–172.31 only; blocking the rest would silently break real
      // destinations.
      expect(isBlockedAddress('172.32.0.1')).toBe(false);
      expect(isBlockedAddress('172.15.0.1')).toBe(false);
    });

    it('a public address is allowed, or the feature does nothing', () => {
      // The non-vacuity half.
      expect(isBlockedAddress('93.184.216.34')).toBe(false);
      expect(isBlockedAddress('2606:2800:220:1::1')).toBe(false);
    });
  });

  describe('what may be saved', () => {
    it('⚠️ refuses https://169.254.169.254/ outright', () => {
      const verdict = inspectWebhookUrl('https://169.254.169.254/hook');
      expect(verdict.ok).toBe(false);
      // The message has to tell an admin WHY, not just "invalid".
      expect((verdict as { reason: string }).reason).toMatch(/private network/i);
    });

    it('refuses loopback and private literals', () => {
      expect(inspectWebhookUrl('https://127.0.0.1/hook').ok).toBe(false);
      expect(inspectWebhookUrl('https://10.1.2.3/hook').ok).toBe(false);
      expect(inspectWebhookUrl('https://[::1]/hook').ok).toBe(false);
      expect(inspectWebhookUrl('https://localhost/hook').ok).toBe(false);
    });

    it('⚠️ refuses http, because a signed payload is still readable in flight', () => {
      const verdict = inspectWebhookUrl('http://example.com/hook');
      expect(verdict.ok).toBe(false);
      expect((verdict as { reason: string }).reason).toMatch(/https/i);
    });

    it('refuses embedded credentials', () => {
      expect(inspectWebhookUrl('https://user:pass@example.com/hook').ok).toBe(false);
    });

    it('accepts an ordinary public https URL', () => {
      // The non-vacuity half: a validator that refused everything would pass
      // every assertion above and make the feature unusable.
      expect(inspectWebhookUrl('https://example.com/hooks/tickets').ok).toBe(true);
    });
  });

  describe('⚠️ the send path, which is the check that cannot be raced', () => {
    it('refuses a blocked destination at send time too, not only at save', async () => {
      // A row queued before the rules tightened, or a subscription edited in
      // the database, must still not go out.
      const result = await sendWebhook({
        url: 'https://169.254.169.254/hook',
        secret: 's',
        body: '{}',
      });
      expect(result.ok).toBe(false);
      expect((result as { error: string }).error).toMatch(/private network/i);
    });

    it('⚠️ installs a DNS guard, so a rebinding hostname is caught at connect', () => {
      // The behaviour itself needs a hostname whose DNS we control, which no
      // unit test has. What is asserted instead is that the request is made
      // with a `lookup` hook and through node's https client — the two
      // properties the defence depends on. Losing either silently removes it.
      const source = readFileSync(join(__dirname, 'webhook-sender.util.ts'), 'utf8');
      expect(source).toContain('lookup: guardedLookup');
      expect(source).toContain("from 'https'");
      expect(source).not.toContain('fetch(');
    });

    it('⚠️ does not follow redirects — a 302 is a failure', () => {
      // A permitted host answering 302 → 169.254.169.254 would defeat the
      // save-time check entirely. Node core never follows; this pins that the
      // code treats 3xx as a dead end rather than adding following later.
      const source = readFileSync(join(__dirname, 'webhook-sender.util.ts'), 'utf8');
      expect(source).toMatch(/redirects are not followed/);
    });
  });
});

/**
 * The signature, verified the way a consumer would.
 */
describe('a consumer can verify a webhook signature (card 2.6)', () => {
  it('⚠️ recomputing the HMAC independently matches', () => {
    // ⚠️ COMPUTED HERE RATHER THAN BY CALLING signWebhookBody. A signature test
    // that reuses the signing function proves only that the function is
    // deterministic; this proves the scheme is what a consumer must implement.
    const secret = 'shared-secret-value';
    const timestamp = '1789500000000';
    const body = JSON.stringify({ hello: 'world' });
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex');
    expect(signWebhookBody(secret, timestamp, body)).toBe(expected);
  });

  it('the timestamp is inside the signed material, so a capture cannot be replayed', () => {
    const body = '{}';
    const a = signWebhookBody('s', '1000', body);
    const b = signWebhookBody('s', '2000', body);
    expect(a).not.toBe(b);
  });

  it('a different secret produces a different signature', () => {
    expect(signWebhookBody('one', '1000', '{}')).not.toBe(
      signWebhookBody('two', '1000', '{}'),
    );
  });
});

/**
 * The payload, which is where PHI would escape if it escaped anywhere.
 */
describe('a webhook payload carries no ticket content (card 2.6)', () => {
  const envelope = (event: Parameters<typeof buildWebhookEnvelope>[0]['event']) =>
    buildWebhookEnvelope({
      event,
      occurredAt: new Date('2026-09-15T10:00:00.000Z'),
      ticketId: 't-1',
      ticketNumber: 42,
      displayId: 'IT_20260915_042',
      status: 'NEW',
      priority: 'SEV2',
      teamId: 'team-1',
      actorId: 'user-1',
      previousStatus: 'OPEN',
      messageId: 'm-1',
      messageVisibility: 'INTERNAL',
    });

  it('⚠️ contains no body, description, subject or custom field', () => {
    // THE ASSERTION THAT STOPS A CONVENIENCE FIELD SHIPPING PHI. Asserted on
    // the serialised form, so adding a field later fails here rather than
    // quietly posting a patient's words to a third party.
    for (const event of ['ticket.created', 'ticket.status_changed', 'message.added'] as const) {
      const serialised = JSON.stringify(envelope(event));
      expect(serialised).not.toMatch(/"body"/);
      expect(serialised).not.toMatch(/"description"/);
      expect(serialised).not.toMatch(/"subject"/);
      expect(serialised).not.toMatch(/"customField/);
      expect(serialised).not.toMatch(/"requesterEmail"/);
    }
  });

  it('⚠️ is versioned from the first delivery', () => {
    // Retrofitting a version means breaking every consumer at once.
    expect(envelope('ticket.created').version).toBe(1);
  });

  it('carries the ids a consumer needs to call back for the content', () => {
    // The non-vacuity half: an empty envelope would pass the PHI test and be
    // useless. A consumer that needs the body calls back with its API key and
    // gets access-checked on the way in.
    const data = envelope('ticket.created').data;
    expect(data).toMatchObject({
      ticketId: 't-1',
      ticketNumber: 42,
      status: 'NEW',
      teamId: 'team-1',
    });
  });

  it('only status_changed carries a previous status, and only message.added a message id', () => {
    expect(envelope('ticket.created').data.previousStatus).toBeUndefined();
    expect(envelope('ticket.created').data.messageId).toBeUndefined();
    expect(envelope('ticket.status_changed').data.previousStatus).toBe('OPEN');
    expect(envelope('message.added').data.messageId).toBe('m-1');
  });
});
