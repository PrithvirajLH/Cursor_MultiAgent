import type { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { FoundryClientService } from './foundry-client.service';
import type { PrismaService } from '../prisma/prisma.service';

const USER = { id: 'u1', email: 'someone@company.com' } as AuthUser;

/**
 * Card 1.106 — `AI_PIPELINE_ENABLED` is a real switch now.
 *
 * ⚠️ IT WAS A CONTROL THAT LOOKED LIVE. The variable is set on the App Service
 * and was read by no code anywhere, so an operator reading those settings would
 * reasonably conclude the AI could be turned off from there. It could not. The
 * only way to stop it was blanking the Foundry credentials, which is
 * destructive, fiddly under pressure, and also made `/api/health/ready` report
 * the pipeline misconfigured — the kill switch and the health signal were one
 * lever.
 *
 * ⚠️ THE ASSERTION THAT MATTERS IS THAT THE CLIENT WAS NEVER CALLED. A switch
 * that still burns a Foundry call and then returns an error is not a kill
 * switch, and a test that only checks the response shape cannot tell the two
 * apart.
 */
describe('the AI pipeline can be switched off (card 1.106)', () => {
  /** A service with every collaborator stubbed, and the flag under our control. */
  const build = (flag: string | undefined) => {
    const runAgent = jest.fn().mockResolvedValue({
      content: '{}',
      toolCallsMade: [],
      latencyMs: 1,
    });
    const create = jest.fn().mockResolvedValue({});
    const service = Object.create(AiService.prototype) as AiService;
    Object.assign(service, {
      config: {
        get: (key: string) => (key === 'AI_PIPELINE_ENABLED' ? flag : undefined),
      } as unknown as ConfigService,
      foundryClient: { runAgent } as unknown as FoundryClientService,
      prisma: {
        ticketEvent: { create },
        aiInferenceLog: { createMany: create },
      } as unknown as PrismaService,
      logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() },
    });
    return { service, runAgent, create };
  };

  it('⚠️ false: no model call, no row written, and a distinct status', async () => {
    // THE REGRESSION ASSERTION. `runAgent` not being called is the whole card;
    // the returned shape is secondary.
    const { service, runAgent, create } = build('false');
    const result = await service.classifyAndCreateTicket(
      { text: 'my laptop is broken' },
      USER,
    );

    expect(runAgent).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result.status).toBe('disabled');
  });

  it('⚠️ disabled is NOT an error — an operator must tell their own change from an outage', async () => {
    const { service } = build('false');
    const result = await service.classifyAndCreateTicket({ text: 'x' }, USER);
    expect(result.status).not.toBe('error');
    expect((result as { reason: string }).reason).toMatch(/switched off/i);
  });

  it('⚠️ the switch covers inbound classification too (card 1.63)', async () => {
    // Card 1.63 gave the AI a SECOND way in - classifying an unrouted email -
    // and an off switch that only covers one of them is not an off switch.
    // Same assertion as above: the client is never called.
    const { service, runAgent } = build('false');
    const result = await service.classifyInboundDepartment(
      'my paycheck is missing overtime',
    );

    expect(runAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ routed: false, reason: 'pipeline_disabled' });
  });

  it('⚠️ unset: the pipeline runs exactly as before', async () => {
    // THE NON-VACUITY HALF, and the one that would hurt most if wrong: a fix
    // that disables the pipeline for everyone passes every assertion above.
    // Production and the test environment both leave this unset or true.
    const { service, runAgent } = build(undefined);
    await service
      .classifyAndCreateTicket({ text: 'x' }, USER)
      .catch(() => undefined);
    expect(runAgent).toHaveBeenCalled();
  });

  it('true: the pipeline runs', async () => {
    const { service, runAgent } = build('true');
    await service
      .classifyAndCreateTicket({ text: 'x' }, USER)
      .catch(() => undefined);
    expect(runAgent).toHaveBeenCalled();
  });

  it('only the literal "false" switches it off', async () => {
    // Guards against a typo silently disabling the AI in production.
    for (const value of ['FALSE ', ' false']) {
      const { service, runAgent } = build(value);
      await service
        .classifyAndCreateTicket({ text: 'x' }, USER)
        .catch(() => undefined);
      expect(runAgent).not.toHaveBeenCalled();
    }
    for (const value of ['0', 'no', 'off', 'disabled']) {
      const { service, runAgent } = build(value);
      await service
        .classifyAndCreateTicket({ text: 'x' }, USER)
        .catch(() => undefined);
      // ⚠️ These do NOT switch it off, deliberately: a half-understood value
      // must not quietly disable the AI. Only "false" does.
      expect(runAgent).toHaveBeenCalled();
    }
  });

  it('⚠️ the debug pipeline is governed by the same switch', async () => {
    // Otherwise "off" would mean "off for everyone except this page", and the
    // debug page runs the same agents against the same quota.
    const { service, runAgent } = build('false');
    const result = await service.debugPipeline({ text: 'x' }, USER);
    expect(runAgent).not.toHaveBeenCalled();
    expect(result.errorMessage).toMatch(/switched off/i);
  });
});
