import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Request, Response } from 'express';
import express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(helmet());
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Serve frontend SPA from "public" folder (same origin as API for single-app deploy)
  const publicDir = join(process.cwd(), 'public');
  if (existsSync(publicDir)) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use(express.static(publicDir));
    // Catch-all for SPA (path-to-regexp v6 rejects bare '*'; use RegExp to avoid that)
    expressApp.get(/^\/(?!api($|\/))/, (req: Request, res: Response) => {
      res.sendFile(join(publicDir, 'index.html'));
    });
    console.log(`Serving frontend from: ${publicDir}`);
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://0.0.0.0:${port}/api`);
}
bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
