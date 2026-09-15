import { readFileSync } from 'fs';
import { join } from 'path';
import { AiService } from './ai.service';

type TraceSteps = (steps: Record<string, unknown>[]) => Record<string, unknown>[];

/**
 * Card 1.91 — the pipeline trace stops quoting the requester.
 *
 * ⚠️ WHY THIS IS NOT AN INTEGRATION TEST. Writing the trace needs a completed
 * pipeline run, and the test environment has no Azure Foundry config, so the
 * run dies at step 1 and the event is never written. The trimming is therefore
 * asserted on the function that does it, plus a source-level guard on the
 * payload literal itself — which is the part that would rot silently if
 * somebody added a field back "just for debugging".
 */
describe('the AI pipeline trace drops the requester\'s words (card 1.91)', () => {
  // traceSteps does not touch `this`, so no DI container is needed to exercise
  // it — and constructing the real service would drag in Prisma and Foundry.
  const service = Object.create(AiService.prototype) as AiService;
  const traceSteps = (
    service as unknown as { traceSteps: TraceSteps }
  ).traceSteps.bind(service);

  const step = () => ({
    step: 1,
    agent: 'intentExtractor',
    status: 'success',
    latencyMs: 42,
    toolsCalled: ['get_user_profile'],
    input: 'User ID: abc\n\nRequest:\nMy HIV test results never arrived',
    rawOutput: '{"intent":"chase a test result"}',
    parsed: { intent: 'chase a test result' },
  });

  it('⚠️ drops the step input, which carried the message verbatim', () => {
    // THE REGRESSION ASSERTION. Dropping `inputText` while leaving this would
    // have moved the same sentence, not removed it.
    const [kept] = traceSteps([step()]);
    expect(kept.input).toBeUndefined();
  });

  it("⚠️ drops the model's answer too, because the model quotes the request back", () => {
    // ⚠️ A LIVE RUN IS WHY THIS IS UNCONDITIONAL. These two were first kept
    // for non-sensitive departments; a real ticket filed with a canary phrase
    // came back with the phrase in `parsed` and `rawOutput`, so the event still
    // quoted the requester - one field further down. AiInferenceLog keeps both
    // under the same sensitivity rule, so nothing is lost here.
    const [kept] = traceSteps([step()]);
    expect(kept.rawOutput).toBeUndefined();
    expect(kept.parsed).toBeUndefined();
    expect(JSON.stringify(kept)).not.toContain('HIV');
    expect(JSON.stringify(kept)).not.toContain('chase a test result');
  });

  it('keeps the half that makes a trace worth having', () => {
    // The non-vacuity half: a function that returned {} would pass everything
    // above and leave the trace useless.
    const [kept] = traceSteps([step()]);
    expect(kept).toMatchObject({
      step: 1,
      agent: 'intentExtractor',
      status: 'success',
      latencyMs: 42,
      toolsCalled: ['get_user_profile'],
    });
  });

  describe('the payload the event is written with', () => {
    const source = readFileSync(join(__dirname, 'ai.service.ts'), 'utf8');
    const start = source.indexOf("type: 'AI_PIPELINE_TRACE'");
    const payload = source.slice(start, source.indexOf('createdById', start));

    it('⚠️ names neither inputText nor userEmail', () => {
      expect(start).toBeGreaterThan(-1);
      expect(payload).not.toContain('inputText');
      expect(payload).not.toContain('userEmail');
    });

    it('still carries the correlationId that joins it to AiInferenceLog', () => {
      // Without this the event is smaller but no longer traceable to the
      // durable logs, which is where the detail went.
      expect(payload).toContain('correlationId');
    });

    it('⚠️ decides redaction before it writes, not after', () => {
      // `redactLogs` used to be computed below this block, so a trace written
      // above it could not have been governed by it.
      expect(source.indexOf('const redactLogs')).toBeLessThan(start);
    });
  });
});
