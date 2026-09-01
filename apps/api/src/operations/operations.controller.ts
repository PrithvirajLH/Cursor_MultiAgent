import {
  Body,
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
import { EmailSuppressionService } from '../notifications/email-suppression.service';
import { ClearEmailSuppressionDto } from './clear-email-suppression.dto';
import { OperationsService } from './operations.service';

/**
 * Admin → Operations (card 1.21). Owner only: running retention with dry run
 * off deletes data, and running the scheduler enqueues automation for every
 * team.
 */
@Controller('operations')
@UseGuards(OwnerGuard)
export class OperationsController {
  constructor(
    private readonly operationsService: OperationsService,
    private readonly emailSuppression: EmailSuppressionService,
  ) {}

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

  /** Addresses the system currently refuses to email, and why (card 1.23). */
  @Get('email-suppressions')
  async listEmailSuppressions() {
    return { data: await this.emailSuppression.listSuppressed() };
  }

  /**
   * Let a suppressed address receive mail again.
   *
   * POST with the address in the body rather than DELETE with it in the path:
   * an email address in a URL segment is an encoding trap, and someone whose
   * mailbox was full for a week must not be unreachable because the way back
   * was fiddly.
   */
  @Post('email-suppressions/clear')
  @HttpCode(HttpStatus.OK)
  @ThrottlePolicy('highWrite')
  async clearEmailSuppression(@Body() payload: ClearEmailSuppressionDto) {
    const cleared = await this.emailSuppression.clear(payload.address);
    return { cleared };
  }
}
