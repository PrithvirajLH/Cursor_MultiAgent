import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { requestContext } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';
const completionLogger = new Logger('Request');

/**
 * Middleware that propagates or generates a request correlation ID (OBS-01).
 * Reads X-Request-Id from the request; if missing, generates a new UUID.
 * Sets the ID on the response header and runs the rest of the chain inside AsyncLocalStorage
 * so getRequestId() returns it for the duration of the request.
 * Logs one completion line per request on response finish (including guard rejections).
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const raw = req.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof raw === 'string' && raw.trim().length > 0
      ? raw.trim()
      : randomUUID();
  (req as Request & { requestId: string }).requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  res.once('finish', () => {
    const method = req.method;
    const url = req.originalUrl ?? req.url ?? '';
    completionLogger.log(
      `Request completed ${method} ${url} ${res.statusCode} requestId=${requestId}`,
    );
  });

  requestContext.run({ requestId }, () => next());
}
