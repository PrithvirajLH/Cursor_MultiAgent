import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { RoutingRulesController } from './routing.controller';
import { RoutingRulesService } from './routing.service';

@Module({
  imports: [RealtimeModule],
  controllers: [RoutingRulesController],
  providers: [RoutingRulesService],
})
export class RoutingRulesModule {}
