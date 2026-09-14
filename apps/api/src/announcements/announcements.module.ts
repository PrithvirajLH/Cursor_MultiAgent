import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

/**
 * Announcements and the outage banner (card 2.7).
 *
 * CommonModule is @Global, so AccessControlService needs no import here.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
