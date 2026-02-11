import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { BulkPriorityDto } from './dto/bulk-priority.dto';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BulkTransferDto } from './dto/bulk-transfer.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FollowTicketDto } from './dto/follow-ticket.dto';
import { ListTicketEventsDto } from './dto/list-ticket-events.dto';
import { ListTicketMessagesDto } from './dto/list-ticket-messages.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { TicketActivityDto } from './dto/ticket-activity.dto';
import { TicketStatusDto } from './dto/ticket-status.dto';
import { TransitionTicketDto } from './dto/transition-ticket.dto';
import { TransferTicketDto } from './dto/transfer-ticket.dto';
import { TicketsService } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  async list(@Query() query: ListTicketsDto, @CurrentUser() user: AuthUser) {
    return this.ticketsService.list(query, user);
  }

  @Get('counts')
  async getCounts(@CurrentUser() user: AuthUser) {
    return this.ticketsService.getCounts(user);
  }

  @Get('activity')
  async getActivity(@Query() query: TicketActivityDto, @CurrentUser() user: AuthUser) {
    return this.ticketsService.getActivity(query, user);
  }

  @Get('status-breakdown')
  async getStatusBreakdown(@Query() query: TicketStatusDto, @CurrentUser() user: AuthUser) {
    return this.ticketsService.getStatusBreakdown(query, user);
  }

  @Get('metrics')
  async getMetrics(@CurrentUser() user: AuthUser) {
    return this.ticketsService.getMetrics(user);
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.getById(id, user);
  }

  @Post()
  async create(
    @Body() payload: CreateTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.create(payload, user);
  }

  @Post('bulk/assign')
  async bulkAssign(
    @Body() payload: BulkAssignDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.bulkAssign(payload, user);
  }

  @Post('bulk/transfer')
  async bulkTransfer(
    @Body() payload: BulkTransferDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.bulkTransfer(payload, user);
  }

  @Post('bulk/status')
  async bulkStatus(
    @Body() payload: BulkStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.bulkStatus(payload, user);
  }

  @Post('bulk/priority')
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

  @Post(':id/messages')
  async addMessage(
    @Param('id') id: string,
    @Body() payload: AddTicketMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.addMessage(id, payload, user);
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async addAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.addAttachment(id, file, user);
  }

  @Post(':id/assign')
  async assign(
    @Param('id') id: string,
    @Body() payload: AssignTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.assign(id, payload, user);
  }

  @Post(':id/transfer')
  async transfer(
    @Param('id') id: string,
    @Body() payload: TransferTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.transfer(id, payload, user);
  }

  @Post(':id/transition')
  async transition(
    @Param('id') id: string,
    @Body() payload: TransitionTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.transition(id, payload, user);
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
}
