import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { ThrottlePolicy } from '../common/throttle-policy.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { BulkPriorityDto } from './dto/bulk-priority.dto';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BulkTagsDto } from './dto/bulk-tags.dto';
import { BulkTransferDto } from './dto/bulk-transfer.dto';
import { BulkUnassignDto } from './dto/bulk-unassign.dto';
import { CreateIntakeTicketDto } from './dto/create-intake-ticket.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { DeleteTicketDto } from './dto/delete-ticket.dto';
import { FollowTicketDto } from './dto/follow-ticket.dto';
import { IngestInboundEmailDto } from './dto/ingest-inbound-email.dto';
import { LinkTicketDto } from './dto/link-ticket.dto';
import { ListTicketEventsDto } from './dto/list-ticket-events.dto';
import { MessageType } from '@prisma/client';
import { ListTicketMessagesDto } from './dto/list-ticket-messages.dto';
import { MessageRecipientsDto } from './dto/message-recipients.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { TicketCountsDto } from './dto/ticket-counts.dto';
import { TicketActivityDto } from './dto/ticket-activity.dto';
import { TicketStatusDto } from './dto/ticket-status.dto';
import { TicketTypingDto } from './dto/ticket-typing.dto';
import { TicketViewingDto } from './dto/ticket-viewing.dto';
import { TransitionTicketDto } from './dto/transition-ticket.dto';
import { TransferTicketDto } from './dto/transfer-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { IntakeService } from './intake.service';
import { TicketsService } from './tickets.service';

// ATTACHMENTS_MAX_MB configuration is now injected via ConfigService

// Hard memory-safety ceiling for multipart uploads. multer buffers the request
// body into memory, so it must abort an oversized upload early instead of
// buffering gigabytes first (DoS). This is a coarse guard set well above any
// realistic configured limit; the exact per-deployment limit
// (ATTACHMENTS_MAX_MB, default 10MB) is still enforced in the handler via
// attachmentsMaxBytes. The decorator evaluates before DI, so ConfigService is
// unavailable here — hence a fixed ceiling. Raise it if ATTACHMENTS_MAX_MB is
// ever configured above ~50.
const ATTACHMENT_UPLOAD_CEILING_BYTES = 50 * 1024 * 1024; // 50 MB

@Controller('tickets')
export class TicketsController {
  private readonly attachmentsMaxBytes: number;

  constructor(
    private readonly ticketsService: TicketsService,
    private readonly configService: ConfigService,
    private readonly intakeService: IntakeService,
  ) {
    const maxMb = Number.parseInt(
      this.configService.get<string>('ATTACHMENTS_MAX_MB') ?? '10',
      10,
    );
    this.attachmentsMaxBytes =
      Math.max(1, Number.isFinite(maxMb) ? maxMb : 10) * 1024 * 1024;
  }

  @Get()
  async list(@Query() query: ListTicketsDto, @CurrentUser() user: AuthUser) {
    return this.ticketsService.list(query, user);
  }

  /**
   * Ten counts became eighteen in card 1.69 step 4, so the sidebar can ask
   * once instead of firing nine `GET /tickets?pageSize=1` calls.
   *
   * The query carries three DATES and nothing else - see TicketCountsDto for
   * why that is not the filter-taking count endpoint the card rules out.
   */
  @Get('counts')
  async getCounts(
    @Query() query: TicketCountsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.getCounts(user, query);
  }

  @Get('activity')
  async getActivity(
    @Query() query: TicketActivityDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.getActivity(query, user);
  }

  @Get('status-breakdown')
  async getStatusBreakdown(
    @Query() query: TicketStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.getStatusBreakdown(query, user);
  }

  @Get('metrics')
  async getMetrics(@CurrentUser() user: AuthUser) {
    return this.ticketsService.getMetrics(user);
  }

  /**
   * The caller's own unfinished tickets, ids included (card 2.2).
   *
   * Declared before @Get(':id') for the same reason export.csv is, below.
   */
  @Get('my-open')
  async myOpenTickets(@CurrentUser() user: AuthUser) {
    return this.ticketsService.myOpenTickets(user);
  }

  // Declared before @Get(':id') — otherwise "export.csv" is swallowed as a ticket id.
  @Get('export.csv')
  exportCsv(@Query() query: ListTicketsDto, @CurrentUser() user: AuthUser) {
    const stamp = new Date().toISOString().slice(0, 10);
    return new StreamableFile(
      Readable.from(this.ticketsService.exportCsv(query, user)),
      {
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="tickets-${stamp}.csv"`,
      },
    );
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.getById(id, user);
  }

  @Post()
  @ThrottlePolicy('highWrite')
  async create(
    @Body() payload: CreateTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.create(payload, user);
  }

  @Post('inbound-email')
  @Public()
  @ThrottlePolicy('webhook')
  async ingestInboundEmail(
    @Body() payload: IngestInboundEmailDto,
    @Headers('x-inbound-email-secret') inboundSecret: string | undefined,
  ) {
    return this.ticketsService.ingestInboundEmail(payload, inboundSecret);
  }

  @Post('intake')
  @Public()
  @ThrottlePolicy('webhook')
  async intake(
    @Body() payload: CreateIntakeTicketDto,
    @Headers('x-intake-secret') intakeSecret: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    // The generic IdempotencyInterceptor is registered globally (app.module.ts)
    // but no-ops when this header is absent — and an integration that retries
    // without a key would create duplicates, so the key is required here.
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(
        'Idempotency-Key header is required (use the flow run id)',
      );
    }
    return this.intakeService.createTicket(payload, intakeSecret);
  }

  @Post('bulk/assign')
  @ThrottlePolicy('highWrite')
  async bulkAssign(
    @Body() payload: BulkAssignDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.bulkAssign(payload, user);
  }

  /**
   * Hand tickets back to their teams' queues (card 2.2).
   *
   * ⚠️ NOT `bulk/assign` WITH NO ASSIGNEE - that assigns them to the caller,
   * because `assign` reads `payload.assigneeId ?? user.id`. Nothing in this API
   * could clear an assignee before this card.
   */
  @Post('bulk/unassign')
  @ThrottlePolicy('highWrite')
  async bulkUnassign(
    @Body() payload: BulkUnassignDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.bulkUnassign(payload, user);
  }

  @Post('bulk/transfer')
  @ThrottlePolicy('highWrite')
  async bulkTransfer(
    @Body() payload: BulkTransferDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.bulkTransfer(payload, user);
  }

  @Post('bulk/status')
  @ThrottlePolicy('highWrite')
  async bulkStatus(
    @Body() payload: BulkStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.bulkStatus(payload, user);
  }

  @Post('bulk/tags')
  @ThrottlePolicy('highWrite')
  async bulkTags(
    @Body() payload: BulkTagsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.bulkTags(payload, user);
  }

  @Post('bulk/priority')
  @ThrottlePolicy('highWrite')
  async bulkPriority(
    @Body() payload: BulkPriorityDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.bulkPriority(payload, user);
  }

  @Get(':id/messages')
  async listMessages(
    @Param('id') id: string,
    @Query() query: ListTicketMessagesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.listMessages(id, user, query.take, query.cursor);
  }

  /**
   * Who the message being composed would reach (card 1.28).
   *
   * Read-only and cheap, but gated by canPostMessage rather than mere read
   * access: the ticket's audience is not something a requester should be able
   * to enumerate on their own ticket.
   */
  @Get(':id/message-recipients')
  async previewMessageRecipients(
    @Param('id') id: string,
    @Query() query: MessageRecipientsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.previewMessageRecipients(
      id,
      query.type ?? MessageType.PUBLIC,
      user,
    );
  }

  /**
   * Remove a message's content (card 1.11).
   *
   * DELETE, because from the reader's point of view the message is gone - but
   * the row stays so the conversation keeps its shape and the timeline keeps
   * its record. The original text is NOT preserved anywhere; see the service.
   */
  @Delete(':id/messages/:messageId')
  @ThrottlePolicy('highWrite')
  async redactMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.redactMessage(id, messageId, user);
  }

  @Post(':id/messages')
  @ThrottlePolicy('highWrite')
  async addMessage(
    @Param('id') id: string,
    @Body() payload: AddTicketMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.addMessage(id, payload, user);
  }

  /** Presence, so two agents do not answer the same requester (card 1.9). */
  @Post(':id/viewing')
  async setViewing(
    @Param('id') id: string,
    @Body() payload: TicketViewingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.setViewing(id, payload, user);
  }

  @Post(':id/typing')
  async setTyping(
    @Param('id') id: string,
    @Body() payload: TicketTypingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.setTyping(id, payload, user);
  }

  @Post(':id/attachments')
  @ThrottlePolicy('highWrite')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: ATTACHMENT_UPLOAD_CEILING_BYTES },
    }),
  )
  async addAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (file && file.size > this.attachmentsMaxBytes) {
      throw new PayloadTooLargeException(
        `Attachment exceeds maximum allowed size`,
      );
    }
    return this.ticketsService.addAttachment(id, file, user);
  }

  @Post(':id/assign')
  @ThrottlePolicy('highWrite')
  async assign(
    @Param('id') id: string,
    @Body() payload: AssignTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.assign(id, payload, user);
  }

  @Post(':id/transfer')
  @ThrottlePolicy('highWrite')
  async transfer(
    @Param('id') id: string,
    @Body() payload: TransferTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.transfer(id, payload, user);
  }

  @Post(':id/transition')
  @ThrottlePolicy('highWrite')
  async transition(
    @Param('id') id: string,
    @Body() payload: TransitionTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.transition(id, payload, user);
  }

  @Delete(':id')
  @ThrottlePolicy('highWrite')
  async remove(
    @Param('id') id: string,
    @Body() payload: DeleteTicketDto | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.softDelete(id, payload ?? {}, user);
  }

  @Post(':id/restore')
  @ThrottlePolicy('highWrite')
  async restore(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.restore(id, user);
  }

  @Patch(':id')
  @ThrottlePolicy('highWrite')
  async update(
    @Param('id') id: string,
    @Body() payload: UpdateTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.update(id, payload, user);
  }

  @Post(':id/category')
  @ThrottlePolicy('highWrite')
  async setCategory(
    @Param('id') id: string,
    @Body() payload: { categoryId: string | null },
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.setCategory(
      id,
      payload?.categoryId ?? null,
      user,
    );
  }

  @Get(':id/events')
  async listEvents(
    @Param('id') id: string,
    @Query() query: ListTicketEventsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.listEvents(id, user, query.take, query.cursor);
  }

  @Get(':id/followers')
  async listFollowers(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.listFollowers(id, user);
  }

  @Post(':id/followers')
  @ThrottlePolicy('highWrite')
  async follow(
    @Param('id') id: string,
    @Body() payload: FollowTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.followTicket(id, payload, user);
  }

  @Delete(':id/followers/:userId')
  async unfollow(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.unfollowTicket(id, userId, user);
  }

  @Post(':id/links')
  @ThrottlePolicy('highWrite')
  async linkTicket(
    @Param('id') id: string,
    @Body() payload: LinkTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.linkTicket(id, payload, user);
  }

  @Delete(':id/links/:linkId')
  async unlinkTicket(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.unlinkTicket(id, linkId, user);
  }
}
