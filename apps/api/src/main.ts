import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Request, Response } from 'express';
import express from 'express';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  app.use(helmet());
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
    logger.log(`Serving frontend from: ${publicDir}`);
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

  logger.log(
    `HTTP timeouts configured: request=${requestTimeoutMs}ms, keepAlive=${keepAliveTimeoutMs}ms, headers=${headersTimeoutMs}ms`,
  );
  logger.log(`Application is running on: http://0.0.0.0:${port}/api`);
}
bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    'Failed to start server',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
