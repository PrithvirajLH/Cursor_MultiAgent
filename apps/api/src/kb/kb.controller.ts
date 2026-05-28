import {
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
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { KbService } from './kb.service';
import { CreateKbArticleDto } from './dto/create-kb-article.dto';
import { UpdateKbArticleDto } from './dto/update-kb-article.dto';
import { ListKbArticlesDto } from './dto/list-kb-articles.dto';
import {
  CreateKbCategoryDto,
  ListKbCategoriesDto,
  UpdateKbCategoryDto,
} from './dto/kb-category.dto';

@Controller('kb')
export class KbController {
  constructor(private readonly kbService: KbService) {}

  // ─── Read (any authenticated user; service enforces visibility) ─────────────

  @Get('articles')
  listArticles(
    @Query() query: ListKbArticlesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.kbService.listArticles(query, user);
  }

  @Get('articles/:slug')
  async getArticle(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    const article = await this.kbService.getArticleBySlug(slug, user);
    const related = await this.kbService.listRelated(
      article.id,
      article.categoryId,
      user,
    );
    return { ...article, related: related.data };
  }

  @Get('categories')
  listCategories(
    @Query() query: ListKbCategoriesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.kbService.listCategories(query, user);
  }

  // ─── Authoring (OWNER + TEAM_ADMIN) ─────────────────────────────────────────

  @Post('articles')
  @UseGuards(AdminGuard)
  createArticle(
    @Body() payload: CreateKbArticleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.kbService.createArticle(payload, user);
  }

  @Patch('articles/:id')
  @UseGuards(AdminGuard)
  updateArticle(
    @Param('id') id: string,
    @Body() payload: UpdateKbArticleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.kbService.updateArticle(id, payload, user);
  }

  @Delete('articles/:id')
  @UseGuards(AdminGuard)
  removeArticle(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.kbService.removeArticle(id, user);
  }

  @Post('categories')
  @UseGuards(AdminGuard)
  createCategory(
    @Body() payload: CreateKbCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.kbService.createCategory(payload, user);
  }

  @Patch('categories/:id')
  @UseGuards(AdminGuard)
  updateCategory(
    @Param('id') id: string,
    @Body() payload: UpdateKbCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.kbService.updateCategory(id, payload, user);
  }

  @Delete('categories/:id')
  @UseGuards(AdminGuard)
  removeCategory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.kbService.removeCategory(id, user);
  }
}
