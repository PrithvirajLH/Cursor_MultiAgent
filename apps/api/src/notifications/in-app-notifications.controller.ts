import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { InAppNotificationsService } from './in-app-notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard)
export class InAppNotificationsController {
  constructor(
    private readonly notificationsService: InAppNotificationsService,
  ) {}

  /**
   * Get notifications for the current user
   */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListNotificationsDto,
  ) {
    return this.notificationsService.findForUser(user.id, {
      page: query.page,
      pageSize: query.pageSize,
      unreadOnly: query.unreadOnly,
    });
  }

  /**
   * Get unread notification count
   */
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: AuthUser) {
    const count = await this.notificationsService.getUnreadCount(user.id);
    return { data: { count } };
  }

  /**
   * Mark a specific notification as read
   */
  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: AuthUser,
    @Param('id') notificationId: string,
  ) {
    await this.notificationsService.markAsRead(notificationId, user.id);
    return { data: { success: true } };
  }

  /**
   * Mark all notifications as read
   */
  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: AuthUser) {
    const result = await this.notificationsService.markAllAsRead(user.id);
    return { data: { success: true, count: result.count } };
  }
}
