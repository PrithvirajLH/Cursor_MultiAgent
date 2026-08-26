import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TicketsModule } from '../tickets/tickets.module';
import { RetentionService } from './retention.service';

@Module({
  imports: [ConfigModule, PrismaModule, TicketsModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
