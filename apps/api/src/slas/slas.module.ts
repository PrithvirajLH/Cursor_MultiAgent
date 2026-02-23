import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SlaBreachService } from './sla-breach.service';
import { SlaEngineService } from './sla-engine.service';
import { SlasController } from './slas.controller';
import { SlasService } from './slas.service';

@Module({
  imports: [PrismaModule, NotificationsModule, RealtimeModule],
  controllers: [SlasController],
  providers: [SlasService, SlaEngineService, SlaBreachService],
  exports: [SlaEngineService],
})
export class SlasModule {}
