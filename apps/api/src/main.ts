import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Request, Response } from 'express';
import express from 'express';
import { AppModule } from './app.module';
import { correlationIdMiddleware } from './common/correlation-id.middleware';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

import { parsePositiveInt } from './common/config.utils';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.use(correlationIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'https:', 'wss:'],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean)
    : [];
  app.enableCors({
    origin: corsOrigins.length
      ? corsOrigins
      : ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());

  // Serve frontend SPA from "public" folder (same origin as API for single-app deploy)
  const publicDir = join(process.cwd(), 'public');
  if (existsSync(publicDir)) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use(express.static(publicDir));
    // Catch-all for SPA (path-to-regexp v6 rejects bare '*'; use RegExp to avoid that)
    expressApp.get(/^\/(?!api($|\/))/, (req: Request, res: Response) => {
      res.sendFile(join(publicDir, 'index.html'));
    });
    app.get(Logger).log(`Serving frontend from: ${publicDir}`, 'Bootstrap');
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  const httpServer = app.getHttpServer();
  const requestTimeoutMs = parsePositiveInt(
    process.env.REQUEST_TIMEOUT_MS,
    120_000,
  );
  const keepAliveTimeoutMs = parsePositiveInt(
    process.env.KEEP_ALIVE_TIMEOUT_MS,
    5_000,
  );
  const configuredHeadersTimeoutMs = parsePositiveInt(
    process.env.HEADERS_TIMEOUT_MS,
    121_000,
  );
  const headersTimeoutMs = Math.max(
    configuredHeadersTimeoutMs,
    keepAliveTimeoutMs + 1_000,
  );

  httpServer.requestTimeout = requestTimeoutMs;
  httpServer.keepAliveTimeout = keepAliveTimeoutMs;
  httpServer.headersTimeout = headersTimeoutMs;

  app.get(Logger).log(
    `HTTP timeouts configured: request=${requestTimeoutMs}ms, keepAlive=${keepAliveTimeoutMs}ms, headers=${headersTimeoutMs}ms`,
    'Bootstrap',
  );
  app.get(Logger).log(`Application is running on: http://0.0.0.0:${port}/api`, 'Bootstrap');
}
bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    'Failed to start server',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
