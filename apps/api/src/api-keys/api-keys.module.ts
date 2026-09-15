import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

/**
 * Machine credentials (card 2.6).
 *
 * `@Global` because `AuthGuard` depends on `ApiKeysService` and the guard is
 * registered application-wide; without this every module that the guard covers
 * would have to import this one.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
