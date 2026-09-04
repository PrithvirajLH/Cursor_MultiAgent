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
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ThrottlePolicy } from '../common/throttle-policy.decorator';
import { StaffOnlyGuard } from '../auth/staff-only.guard';
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

  /**
   * Making a template is ordinary agent work, but not a requester's (1.7b §3a).
   *
   * The guard is only on the write routes. `list` stays open because it is
   * already scoped to the caller's own plus their team's, and an EMPLOYEE has
   * neither - so it simply returns nothing for them.
   */
  @Post()
  @UseGuards(StaffOnlyGuard)
  create(@Body() dto: CreateCannedResponseDto, @CurrentUser() user: AuthUser) {
    return this.cannedResponsesService.create(dto, user);
  }

  @Patch(':id')
  @UseGuards(StaffOnlyGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCannedResponseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cannedResponsesService.update(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(StaffOnlyGuard)
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
