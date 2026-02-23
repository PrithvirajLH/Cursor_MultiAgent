import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  imports: [RealtimeModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
