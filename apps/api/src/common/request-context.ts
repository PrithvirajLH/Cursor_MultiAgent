import { AsyncLocalStorage } from 'async_hooks';

/** Request-scoped context (OBS-01). Used by correlation-id middleware and getRequestId(). */
export interface RequestContextData {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContextData>();

/** Returns the current request's correlation ID if running within a request (OBS-01). */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
