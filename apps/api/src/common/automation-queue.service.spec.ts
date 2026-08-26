import { ConfigService } from '@nestjs/config';
import { AutomationQueueService } from './automation-queue.service';
import type { RuleEngineService } from '../automation/rule-engine.service';

// Make `new IORedis(...)` throw so onModuleInit takes the constructor-failure
// path into fallbackToInline() without any real Redis. Named exports stay real
// so bullmq still loads.
jest.mock('ioredis', () => ({
  ...jest.requireActual<Record<string, unknown>>('ioredis'),
  __esModule: true,
  default: jest.fn(() => {
    throw new Error('redis client could not be constructed');
  }),
}));

describe('AutomationQueueService.getStatus', () => {
  it('reports disabled when AUTOMATION_QUEUE_ENABLED=false', () => {
    const config = new ConfigService({ AUTOMATION_QUEUE_ENABLED: 'false' });
    const ruleEngine = {} as RuleEngineService;
    const service = new AutomationQueueService(config, ruleEngine);
    service.onModuleInit();
    expect(service.getStatus()).toBe('disabled');
  });

  it('reports inline-fallback when the Redis client cannot be constructed', () => {
    const config = new ConfigService({ AUTOMATION_QUEUE_ENABLED: 'true' });
    const ruleEngine = {} as RuleEngineService;
    const service = new AutomationQueueService(config, ruleEngine);
    service.onModuleInit();
    expect(service.getStatus()).toBe('inline-fallback');
  });
});
