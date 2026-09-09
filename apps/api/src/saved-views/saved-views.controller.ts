import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';
import { SetHiddenPresetsDto } from './dto/set-hidden-presets.dto';
import { UpdateSavedViewDto } from './dto/update-saved-view.dto';
import { SavedViewsService } from './saved-views.service';

@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly savedViewsService: SavedViewsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.savedViewsService.list(user);
  }

  /**
   * Which built-in sidebar presets this caller's team has switched off.
   *
   * ⚠️ Declared BEFORE any `:id` route. Nest matches in declaration order, so a
   * literal segment registered after a parameter route would be swallowed by it.
   */
  @Get('hidden-presets')
  listHiddenPresets(@CurrentUser() user: AuthUser) {
    return this.savedViewsService.listHiddenPresets(user);
  }

  /** Replace a team's hidden-preset list. Team admins and owners only. */
  @Put('hidden-presets/:teamId')
  setHiddenPresets(
    @Param('teamId') teamId: string,
    @Body() dto: SetHiddenPresetsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.savedViewsService.setHiddenPresets(teamId, dto.presetIds, user);
  }

  @Post()
  create(@Body() dto: CreateSavedViewDto, @CurrentUser() user: AuthUser) {
    return this.savedViewsService.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSavedViewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.savedViewsService.update(id, dto, user);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.savedViewsService.delete(id, user);
  }
}
