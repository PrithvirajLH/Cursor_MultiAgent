import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AiAccuracyService } from './ai-accuracy.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, AiAccuracyService],
})
export class ReportsModule {}
