import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { KbController } from './kb.controller';
import { KbService } from './kb.service';

@Module({
  imports: [RealtimeModule],
  controllers: [KbController],
  providers: [KbService],
  exports: [KbService],
})
export class KbModule {}
