import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  /**
   * What the banner renders (card 2.7).
   *
   * ⚠️ DELIBERATELY NOT `@Public()`. Every route that renders the banner is
   * behind auth already, and making this public would put the organisation's
   * outage notices — "the VPN is down", naming internal systems — on the open
   * internet. It is also the sort of decoration that gets copied to the next
   * endpoint by someone in a hurry.
   *
   * Declared before `:id` so "active" is never read as an id.
   */
  @Get('active')
  listActive(@CurrentUser() user: AuthUser) {
    return this.announcements.listActive(user);
  }

  /** The admin list: scheduled and expired included. */
  @Get()
  @UseGuards(AdminGuard)
  list(@CurrentUser() user: AuthUser) {
    return this.announcements.list(user);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: AuthUser) {
    return this.announcements.create(dto, user);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.announcements.update(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.announcements.remove(id, user);
  }
}
