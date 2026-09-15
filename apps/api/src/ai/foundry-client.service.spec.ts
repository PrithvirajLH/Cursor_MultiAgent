import { ConfigService } from '@nestjs/config';
import { FoundryClientService } from './foundry-client.service';
import { ToolRegistryService } from './tools/tool-registry.service';

interface CapturedCall {
  path: string;
  body: Record<string, unknown>;
}

/**
 * Guards the two failures that made AI intake unusable.
 *
 * 1. The grounding tools were never offered to the model, so the classifier
 *    invented department ids and reported them at 0.99 confidence.
 * 2. When tools WERE offered, the follow-up call that returns their results
 *    did not mirror the initial call's mode — it handed the conversation to the
 *    Azure agent, whose own prompt answered and ignored the tool output.
 *
 * Both are invisible without a live model, so they are pinned here instead.
 */
/**
 * The identity a tool call runs as (card 1.85). This spec is about transport
 * shape, not identity, so one fixed context is enough - but it is REQUIRED, and
 * that is the point: the argument cannot be forgotten the way a field could.
 */
const TEST_CONTEXT = {
  user: null,
  subjectId: '11111111-1111-4111-8111-111111111111',
} as const;

describe('FoundryClientService — request construction', () => {
  let calls: CapturedCall[];

  function buildService(env: Record<string, string | undefined>) {
    const service = new FoundryClientService(
      { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService,
      {
        executeTool: jest.fn().mockResolvedValue('{"success":true,"data":[]}'),
      } as unknown as ToolRegistryService,
    );
    return service;
  }

  /** Fake transport that records every request and replays scripted responses. */
  function attachClient(
    service: FoundryClientService,
    responses: Array<Record<string, unknown>>,
  ) {
    let index = 0;
    const client = {
      post: jest.fn((path: string, init: { body: Record<string, unknown> }) => {
        calls.push({ path, body: init.body });
        const response = responses[Math.min(index, responses.length - 1)];
        index += 1;
        return Promise.resolve(response);
      }),
    };
    (service as unknown as { client: unknown }).client = client;
    return client;
  }

  function textResponse(id: string, text: string) {
    return {
      id,
      status: 'completed',
      output: [
        { type: 'message', content: [{ type: 'output_text', text }] },
      ],
    };
  }

  function toolCallResponse(id: string, name: string) {
    return {
      id,
      status: 'completed',
      output: [
        { type: 'function_call', name, call_id: 'call-1', arguments: '{}' },
      ],
    };
  }

  beforeEach(() => {
    calls = [];
  });

  describe('inline mode (the default)', () => {
    it('sends the repo prompt and the grounding tools, and no agent reference', async () => {
      const service = buildService({ AZURE_AI_FOUNDRY_MODEL: 'test-model' });
      attachClient(service, [textResponse('r1', '{}')]);

      await service.runAgent('departmentClassifier', 'classify this', TEST_CONTEXT);

      const body = calls[0].body;
      expect(body.agent_reference).toBeUndefined();
      expect(typeof body.instructions).toBe('string');
      expect(String(body.instructions).length).toBeGreaterThan(0);
      const tools = body.tools as Array<{ name: string }>;
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'get_categories',
        'get_departments',
        'get_routing_rules',
      ]);
    });

    it('flattens tools into Responses API shape, not nested under `function`', async () => {
      const service = buildService({});
      attachClient(service, [textResponse('r1', '{}')]);

      await service.runAgent('departmentClassifier', 'classify this', TEST_CONTEXT);

      const [tool] = calls[0].body.tools as Array<Record<string, unknown>>;
      expect(tool.type).toBe('function');
      expect(tool.name).toBe('get_departments');
      expect(tool).not.toHaveProperty('function');
      expect(tool).toHaveProperty('parameters');
    });

    it('keeps the same mode when returning tool results', async () => {
      const service = buildService({});
      attachClient(service, [
        toolCallResponse('r1', 'get_departments'),
        textResponse('r2', '{}'),
      ]);

      await service.runAgent('departmentClassifier', 'classify this', TEST_CONTEXT);

      expect(calls).toHaveLength(2);
      const followUp = calls[1].body;
      // The regression: this used to carry agent_reference, handing the
      // conversation to the Azure agent mid-flight.
      expect(followUp.agent_reference).toBeUndefined();
      expect(followUp.instructions).toBe(calls[0].body.instructions);
      expect(followUp.tools).toBeDefined();
      expect(followUp.previous_response_id).toBe('r1');
    });

    it('never offers create_ticket to the generator', async () => {
      const service = buildService({});
      attachClient(service, [textResponse('r1', '{}')]);

      await service.runAgent('ticketGenerator', 'draft this', TEST_CONTEXT);

      // Persistence is the pipeline's job. Handing the model a write tool would
      // let a dry run create real tickets.
      expect(calls[0].body.tools).toBeUndefined();
      expect(calls[0].body.instructions).toBeDefined();
    });

    it('offers no tools to the clarifying-question step', async () => {
      const service = buildService({});
      attachClient(service, [textResponse('r1', '{}')]);

      await service.runAgent('confidenceGate', 'ask something', TEST_CONTEXT);

      expect(calls[0].body.tools).toBeUndefined();
    });
  });

  describe('agent mode (AI_INLINE_PROMPTS=false)', () => {
    it('sends the agent reference and no tools', async () => {
      const service = buildService({
        AI_INLINE_PROMPTS: 'false',
        DEPARTMENT_CLASSIFIER_AGENT_ID: 'classifier-agent',
      });
      attachClient(service, [textResponse('r1', '{}')]);

      await service.runAgent('departmentClassifier', 'classify this', TEST_CONTEXT);

      const body = calls[0].body;
      expect(body.agent_reference).toEqual({
        name: 'classifier-agent',
        type: 'agent_reference',
      });
      // Azure rejects tools alongside an agent reference:
      // "400 Not allowed when agent is specified".
      expect(body.tools).toBeUndefined();
      expect(body.instructions).toBeUndefined();
    });

    it('keeps the agent reference when returning tool results', async () => {
      const service = buildService({
        AI_INLINE_PROMPTS: 'false',
        DEPARTMENT_CLASSIFIER_AGENT_ID: 'classifier-agent',
      });
      attachClient(service, [
        toolCallResponse('r1', 'get_departments'),
        textResponse('r2', '{}'),
      ]);

      await service.runAgent('departmentClassifier', 'classify this', TEST_CONTEXT);

      expect(calls[1].body.agent_reference).toEqual({
        name: 'classifier-agent',
        type: 'agent_reference',
      });
      expect(calls[1].body.tools).toBeUndefined();
    });
  });

  it('reports which tools the model actually called', async () => {
    const service = buildService({});
    attachClient(service, [
      toolCallResponse('r1', 'get_departments'),
      textResponse('r2', '{}'),
    ]);

    const result = await service.runAgent('departmentClassifier', 'classify', TEST_CONTEXT);

    // An empty list here is the signature of an ungrounded run.
    expect(result.toolCallsMade).toEqual(['get_departments']);
  });
});
