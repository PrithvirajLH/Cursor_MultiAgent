import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ThrottlePolicy } from '../common/throttle-policy.decorator';
import { CreateCannedResponseDto } from './dto/create-canned-response.dto';
import { UpdateCannedResponseDto } from './dto/update-canned-response.dto';
import { CannedResponsesService } from './canned-responses.service';

@Controller('canned-responses')
export class CannedResponsesController {
  constructor(
    private readonly cannedResponsesService: CannedResponsesService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.cannedResponsesService.list(user);
  }

  @Post()
  create(@Body() dto: CreateCannedResponseDto, @CurrentUser() user: AuthUser) {
    return this.cannedResponsesService.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCannedResponseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cannedResponsesService.update(id, dto, user);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.cannedResponsesService.delete(id, user);
  }

  /**
   * What this macro would say and do, without doing it (card 1.7).
   *
   * A POST rather than a GET because it is per-ticket and not cacheable, and
   * because the ticket id is part of the authorisation rather than a filter.
   */
  @Post(':id/render')
  render(
    @Param('id') id: string,
    @Query('ticketId') ticketId: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (!ticketId) {
      throw new BadRequestException('ticketId is required');
    }
    return this.cannedResponsesService.render(id, ticketId, user);
  }

  /** Run the macro's actions. The message itself is sent by the composer. */
  @Post(':id/apply')
  @ThrottlePolicy('highWrite')
  apply(
    @Param('id') id: string,
    @Query('ticketId') ticketId: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (!ticketId) {
      throw new BadRequestException('ticketId is required');
    }
    return this.cannedResponsesService.apply(id, ticketId, user);
  }
}
