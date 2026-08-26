import { ConfigService } from '@nestjs/config';
import { EmailQueueService } from './email-queue.service';
import type { EmailProcessorService } from './email-processor.service';

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

describe('EmailQueueService.getStatus', () => {
  it('reports disabled when NOTIFICATIONS_QUEUE_ENABLED=false', () => {
    const config = new ConfigService({ NOTIFICATIONS_QUEUE_ENABLED: 'false' });
    const processor = {} as EmailProcessorService;
    const service = new EmailQueueService(config, processor);
    service.onModuleInit();
    expect(service.getStatus()).toBe('disabled');
  });

  it('reports inline-fallback when the Redis client cannot be constructed', () => {
    const config = new ConfigService({ NOTIFICATIONS_QUEUE_ENABLED: 'true' });
    const processor = {} as EmailProcessorService;
    const service = new EmailQueueService(config, processor);
    service.onModuleInit();
    expect(service.getStatus()).toBe('inline-fallback');
  });
});
