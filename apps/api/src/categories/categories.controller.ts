import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesDto } from './dto/list-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async list(@Query() query: ListCategoriesDto, @CurrentUser() user: AuthUser) {
    return this.categoriesService.list(query, user);
  }

  @Post()
  async create(
    @Body() payload: CreateCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categoriesService.create(payload, user);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() payload: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.categoriesService.update(id, payload, user);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.categoriesService.remove(id, user);
  }
}
