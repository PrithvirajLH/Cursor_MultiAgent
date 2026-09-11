import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AvailabilityReturnService } from './availability-return.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, AvailabilityReturnService],
  exports: [AvailabilityReturnService],
})
export class UsersModule {}
