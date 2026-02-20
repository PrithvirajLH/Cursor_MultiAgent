import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';
import { UpdateSavedViewDto } from './dto/update-saved-view.dto';
import { SavedViewsService } from './saved-views.service';

@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly savedViewsService: SavedViewsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.savedViewsService.list(user);
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
