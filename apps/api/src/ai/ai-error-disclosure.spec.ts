import type { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AiService } from './ai.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { FoundryClientService } from './foundry-client.service';

const USER = { id: 'u1', email: 'employee@company.com' } as AuthUser;

/** What a real Azure SDK failure looks like, and every part of it is sensitive. */
const AZURE_ERROR = new Error(
  '404 Resource not found: https://ai-ticketmaster-eastus2.openai.azure.com/' +
    'openai/deployments/gpt-5-4-mini-prod/chat/completions?api-version=2026-01-01 ' +
    '(request id 7f3a2c11-region-eastus2, quota tier S0, billing account 9931)',
);

/**
 * Card 1.107 — the raw error stopped going to whoever asked.
 *
 * ⚠️ `POST /api/ai/classify` HAS NO ROLE GUARD. It takes `@CurrentUser()` and
 * nothing else, so any EMPLOYEE could call it and read whatever the Azure SDK
 * put in `.message`: endpoint hostnames, deployment and model names, region,
 * request ids, quota and billing state, sometimes a fragment of the request.
 *
 * ⚠️ THIS IS CARD 1.57 IN THE OTHER DIRECTION. That card stopped credentials
 * being written into the log — and the log at least needed Azure access to
 * read. This handed infrastructure detail straight back over HTTP to the least
 * privileged role in the system.
 */
describe('an AI failure tells the caller nothing about the infrastructure (card 1.107)', () => {
  const build = () => {
    const errorLog: string[] = [];
    const runAgent = jest.fn().mockRejectedValue(AZURE_ERROR);
    const service = Object.create(AiService.prototype) as AiService;
    Object.assign(service, {
      config: { get: () => undefined } as unknown as ConfigService,
      foundryClient: { runAgent } as unknown as FoundryClientService,
      logger: {
        error: (message: string) => errorLog.push(String(message)),
        warn: jest.fn(),
        log: jest.fn(),
        debug: jest.fn(),
      },
    });
    return { service, errorLog };
  };

  it('⚠️ the serialised response contains none of the Azure detail', async () => {
    // THE REGRESSION ASSERTION, and it is on the WHOLE payload rather than one
    // field - twice this month a field-level assertion passed while the data
    // still went out (card 1.96's follower route, card 1.91's AI canary).
    const { service } = build();
    const result = await service.classifyAndCreateTicket({ text: 'help' }, USER);
    const body = JSON.stringify(result);

    expect(body).not.toContain('openai.azure.com');
    expect(body).not.toContain('gpt-5-4-mini-prod');
    expect(body).not.toContain('eastus2');
    expect(body).not.toContain('billing account');
    expect(body).not.toContain('quota tier');
    expect(body).not.toContain('404 Resource not found');
  });

  it('⚠️ the full text IS in the log — throwing it away would be worse', async () => {
    // THE NON-VACUITY HALF. A fix that discards the detail entirely passes the
    // test above and leaves nobody able to diagnose anything.
    const { service, errorLog } = build();
    await service.classifyAndCreateTicket({ text: 'help' }, USER);
    expect(errorLog.join('\n')).toContain('openai.azure.com');
    expect(errorLog.join('\n')).toContain('gpt-5-4-mini-prod');
  });

  it('keeps `step`, which is useful and not sensitive', async () => {
    // The card is explicit: do not flatten the envelope while in here. The web
    // page renders this.
    const { service } = build();
    const result = await service.classifyAndCreateTicket({ text: 'help' }, USER);
    expect(result.status).toBe('error');
    expect((result as { step: string }).step).toBe('intent_extraction');
  });

  it('gives the caller a stable sentence they can act on', async () => {
    const { service } = build();
    const result = await service.classifyAndCreateTicket({ text: 'help' }, USER);
    expect((result as { error: string }).error).toMatch(/could not process/i);
    expect((result as { error: string }).error).toMatch(/service desk/i);
  });

  describe('⚠️ every site, not just the first', () => {
    // The card counts four; there are FIVE - the four SDK catches plus the
    // ticket-tool failure, whose message can carry database detail. Asserted
    // from the source so a sixth cannot be added in the old shape.
    const source = readFileSync(join(__dirname, 'ai.service.ts'), 'utf8');

    it('no site interpolates a raw error message into a response', () => {
      const leaking = source.match(
        /error: `[^`]*\$\{error instanceof Error \? error\.message/g,
      );
      expect(leaking).toBeNull();
    });

    it('the tool failure does not pass its own message through either', () => {
      expect(source).not.toContain('error: ticketResult.error,');
    });
  });
});
