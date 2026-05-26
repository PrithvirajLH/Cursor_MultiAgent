import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { TagsService } from './tags.service';

@Controller()
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get('tags')
  async autocomplete(@Query('q') q?: string, @Query('limit') limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.tagsService.autocomplete(q, parsedLimit);
  }

  @Get('admin/tags')
  async listAll(@CurrentUser() actor: AuthUser) {
    return this.tagsService.listAllForAdmin(actor);
  }

  @Post('admin/tags')
  async createStandalone(
    @Body() body: { name: string },
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tagsService.createStandalone(body?.name ?? '', actor);
  }

  @Post('tickets/:id/tags')
  async addToTicket(
    @Param('id') ticketId: string,
    @Body() body: { name: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.tagsService.addToTicket(ticketId, body?.name ?? '', user);
  }

  @Delete('tickets/:ticketId/tags/:tagId')
  async removeFromTicket(
    @Param('ticketId') ticketId: string,
    @Param('tagId') tagId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tagsService.removeFromTicket(ticketId, tagId, user);
  }

  @Post('admin/tags/:id/rename')
  async rename(
    @Param('id') tagId: string,
    @Body() body: { name: string },
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tagsService.rename(tagId, body?.name ?? '', actor);
  }

  @Post('admin/tags/merge')
  async merge(
    @Body() body: { fromIds: string[]; intoId: string },
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tagsService.merge(body?.fromIds ?? [], body?.intoId ?? '', actor);
  }

  @Delete('admin/tags/:id')
  async deleteTag(@Param('id') tagId: string, @CurrentUser() actor: AuthUser) {
    return this.tagsService.deleteTag(tagId, actor);
  }
}
