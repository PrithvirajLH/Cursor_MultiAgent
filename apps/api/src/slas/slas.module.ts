import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TicketRealtimeService } from '../tickets/ticket-realtime.service';
import { BusinessHoursCacheService } from './business-hours-cache.service';
import { SlaBreachService } from './sla-breach.service';
import { SlaEngineService } from './sla-engine.service';
import { SlasController } from './slas.controller';
import { SlasService } from './slas.service';

@Module({
  imports: [PrismaModule, NotificationsModule, RealtimeModule],
  controllers: [SlasController],
  providers: [
    SlasService,
    SlaEngineService,
    SlaBreachService,
    BusinessHoursCacheService,
    // Provided here rather than imported from TicketsModule, which already
    // imports this module - taking it the other way would be a cycle. The
    // service is stateless and its dependencies are global, so a second
    // instance behaves identically to the one in TicketsModule.
    TicketRealtimeService,
  ],
  exports: [SlaEngineService, BusinessHoursCacheService, SlaBreachService],
})
export class SlasModule {}
