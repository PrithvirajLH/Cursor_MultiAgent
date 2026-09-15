import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { ClassifyTicketDto } from './dto/classify.dto';
import { DebugPipelineDto } from './dto/debug.dto';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * POST /api/ai/classify
   * Runs the full 4-step AI classification pipeline and creates a ticket.
   *
   * ⚠️ CARD 1.85: THE REQUESTER IS THE SIGNED-IN USER, FULL STOP. This read
   * `dto.userId ?? user.id`, so a body field beat the session: anyone could
   * file as anyone, and the pipeline would then look up that person's profile
   * and last ten tickets and fold them into the ticket it wrote. The field is
   * gone from the DTO, so there is nothing here to prefer.
   */
  @Post('classify')
  @HttpCode(HttpStatus.OK)
  async classify(
    @Body() dto: ClassifyTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    const result = await this.aiService.classifyAndCreateTicket(
      {
        text: dto.text,
        userId: user.id,
        channel: dto.channel ?? 'PORTAL',
      },
      user,
    );

    return result;
  }

  /**
   * POST /api/ai/debug
   * Runs the debug pipeline with step-by-step output.
   * Restricted to TEAM_ADMIN and OWNER roles.
   *
   * ⚠️ CARD 1.85, AND THIS ONE IS NOT SYMMETRIC WITH `classify`. The debug page
   * has a free-text "UUID of the requester" box, used to reproduce a routing
   * decision as the person who actually hit it — a real capability, so it is
   * not simply deleted. It is narrowed to OWNER, who can already read every
   * ticket and therefore gains nothing from it. For a TEAM_ADMIN the same box
   * was a way out of their own team's scope, so it is REFUSED rather than
   * quietly ignored: a debug trace that silently ran as someone else would be a
   * diagnostic tool that lies about what it did.
   */
  @Post('debug')
  @HttpCode(HttpStatus.OK)
  async debug(
    @Body() dto: DebugPipelineDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (user.role !== 'TEAM_ADMIN' && user.role !== 'OWNER') {
      throw new ForbiddenException('Only admins can access the debug pipeline');
    }
    if (dto.userId && dto.userId !== user.id && user.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only an owner can run the pipeline as another user',
      );
    }

    return this.aiService.debugPipeline(
      {
        text: dto.text,
        userId: dto.userId ?? user.id,
        channel: 'PORTAL',
      },
      user,
    );
  }

  /**
   * GET /api/ai/analysis/:ticketId
   * Retrieves the AI classification analysis for a specific ticket.
   */
  @Get('analysis/:ticketId')
  async getAnalysis(
    @Param('ticketId') ticketId: string,
    @CurrentUser() user: AuthUser,
  ) {
    // ⚠️ CARD 1.79: `@CurrentUser` is the fix. Without it this endpoint
    // answered about any ticket to anybody signed in.
    const data = await this.aiService.getAiAnalysis(ticketId, user);
    return { data };
  }
}
