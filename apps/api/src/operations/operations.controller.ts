import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OwnerGuard } from '../auth/owner.guard';
import { ThrottlePolicy } from '../common/throttle-policy.decorator';
import { OperationsService } from './operations.service';

/**
 * Admin → Operations (card 1.21). Owner only: running retention with dry run
 * off deletes data, and running the scheduler enqueues automation for every
 * team.
 */
@Controller('operations')
@UseGuards(OwnerGuard)
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  snapshot() {
    return this.operationsService.snapshot();
  }

  @Post('jobs/:key/run')
  // Running a job creates nothing; 200 is the honest answer.
  @HttpCode(HttpStatus.OK)
  @ThrottlePolicy('highWrite')
  runJob(@Param('key') key: string) {
    return this.operationsService.runJob(key);
  }
}
