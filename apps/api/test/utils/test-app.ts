import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

/**
 * Boot the real application for an integration test.
 *
 * ⚠️ `overrideProviders` was added for card 1.24, whose worker talks to
 * Microsoft Graph. It exists so ONE dependency - the outside world - can be
 * swapped while everything else stays real: the same modules, the same
 * database, the same ingestion path. It defaults to nothing, so every existing
 * caller boots exactly the app it booted before.
 */
export async function createTestApp(options?: {
  overrideProviders?: Array<{ provide: unknown; useValue: unknown }>;
}): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
  });
  for (const override of options?.overrideProviders ?? []) {
    builder = builder.overrideProvider(override.provide).useValue(override.useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  return app;
}
