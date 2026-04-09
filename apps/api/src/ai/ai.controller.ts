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
        userId: dto.userId ?? user.id,
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
  ) {
    const data = await this.aiService.getAiAnalysis(ticketId);
    return { data };
  }
}
