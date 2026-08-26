/** Shared readiness vocabulary for the BullMQ-backed queues. */
export type QueueStatus =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'inline-fallback';
