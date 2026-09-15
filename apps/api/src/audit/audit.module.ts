import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditController } from './audit.controller';
import { AdminAuditService } from './admin-audit.service';
import { AuditService } from './audit.service';

/**
 * ⚠️ @Global so the five services card 1.95 adds writers to can inject
 * AdminAuditService WITHOUT importing this module. That is not laziness: adding
 * five new module imports would reorder ES module evaluation, and this repo has
 * a latent import cycle that surfaces exactly when that order changes - see the
 * comment on the last import statements in app.module.ts.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService, AdminAuditService],
  exports: [AdminAuditService],
})
export class AuditModule {}
