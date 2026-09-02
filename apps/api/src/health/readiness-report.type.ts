import type { QueueStatus } from '../common/queue-status.type';
import type { OutboxCounts } from '../notifications/outbox.service';
import type { SlaWorkerState } from '../slas/sla-worker-state.type';

/** Shape of GET /api/health/ready. States only — never configuration values. */
export type ReadinessReport = {
  status: 'ok' | 'degraded';
  checkedAt: string;
  db: 'ok' | 'error';
  redis: { emailQueue: QueueStatus; automationQueue: QueueStatus };
  smtp: 'configured' | 'missing';
  webPubSub: 'configured' | 'disabled';
  blobStorage: 'azure' | 'local-disk';
  attachmentScanner: 'configured' | 'bypass' | 'gate-off' | 'blocked';
  aiPipeline: 'configured' | 'disabled';
  slaWorker: SlaWorkerState;
  /**
   * Email outbox depth (card 1.32). `null` when the count could not be read -
   * a broken garnish must not take readiness down with it.
   */
  outbox: OutboxCounts | null;
};
