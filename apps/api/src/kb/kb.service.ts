import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KbArticleStatus, Prisma, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateKbArticleDto } from './dto/create-kb-article.dto';
import { UpdateKbArticleDto } from './dto/update-kb-article.dto';
import { ListKbArticlesDto } from './dto/list-kb-articles.dto';
import {
  CreateKbCategoryDto,
  ListKbCategoriesDto,
  UpdateKbCategoryDto,
} from './dto/kb-category.dto';

const ARTICLE_LIST_SELECT = {
  id: true,
  title: true,
  slug: true,
  summary: true,
  status: true,
  isInternal: true,
  viewCount: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  author: { select: { id: true, displayName: true, email: true } },
} satisfies Prisma.KbArticleSelect;

@Injectable()
export class KbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Agents (and up) may see internal articles; employees may not. */
  private isAgent(user: AuthUser): boolean {
    return (
      user.role === UserRole.AGENT ||
      user.role === UserRole.LEAD ||
      user.role === UserRole.TEAM_ADMIN ||
      user.role === UserRole.OWNER
    );
  }

  /** Only owners and team admins may author articles. */
  private canAuthor(user: AuthUser): boolean {
    return user.role === UserRole.OWNER || user.role === UserRole.TEAM_ADMIN;
  }

  private ensureAuthor(user: AuthUser) {
    if (!this.canAuthor(user)) {
      throw new ForbiddenException(
        'Knowledge base authoring is restricted to owners and team administrators',
      );
    }
  }

  /**
   * Visibility filter applied to every read:
   * - authors (OWNER/TEAM_ADMIN): everything (incl. drafts + internal)
   * - agents (AGENT/LEAD): published, incl. internal
   * - everyone else (EMPLOYEE): published AND non-internal only
   */
  private visibilityWhere(user: AuthUser): Prisma.KbArticleWhereInput {
    if (this.canAuthor(user)) return {};
    if (this.isAgent(user)) return { status: KbArticleStatus.PUBLISHED };
    return { status: KbArticleStatus.PUBLISHED, isInternal: false };
  }

  // ─── Articles ──────────────────────────────────────────────────────────────

  async listArticles(query: ListKbArticlesDto, user: AuthUser) {
    const filters: Prisma.KbArticleWhereInput[] = [this.visibilityWhere(user)];

    if (query.categoryId) {
      filters.push({ categoryId: query.categoryId });
    }
    if (query.status && this.canAuthor(user)) {
      filters.push({ status: query.status as KbArticleStatus });
    }
    if (query.q) {
      const term = query.q.trim();
      filters.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { summary: { contains: term, mode: 'insensitive' } },
          { content: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    const data = await this.prisma.kbArticle.findMany({
      where: { AND: filters },
      select: ARTICLE_LIST_SELECT,
      orderBy: [{ updatedAt: 'desc' }],
    });

    return { data };
  }

  async getArticleBySlug(slug: string, user: AuthUser) {
    const article = await this.prisma.kbArticle.findFirst({
      where: { AND: [{ slug }, this.visibilityWhere(user)] },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        author: { select: { id: true, displayName: true, email: true } },
      },
    });

    if (!article) {
      // Don't leak existence of drafts/internal articles to unauthorized users.
      throw new NotFoundException('Article not found');
    }

    // Best-effort view count (don't fail the read if it errors).
    void this.prisma.kbArticle
      .update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    return article;
  }

  /** Related published articles in the same category (visibility-respecting). */
  async listRelated(articleId: string, categoryId: string | null, user: AuthUser) {
    if (!categoryId) return { data: [] };
    const data = await this.prisma.kbArticle.findMany({
      where: {
        AND: [
          { categoryId, id: { not: articleId } },
          this.visibilityWhere(user),
        ],
      },
      select: { id: true, title: true, slug: true, summary: true },
      orderBy: [{ viewCount: 'desc' }, { updatedAt: 'desc' }],
      take: 5,
    });
    return { data };
  }

  /**
   * Keyword suggestions for the AI submit flow. Searches visible PUBLISHED
   * articles by the strongest terms in the supplied text. Never throws — the
   * caller treats a failure as "no suggestions".
   */
  async suggest(
    text: string,
    user: AuthUser,
    limit = 3,
  ): Promise<
    Array<{ id: string; title: string; slug: string; summary: string | null }>
  > {
    const terms = Array.from(
      new Set(
        (text || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 4),
      ),
    ).slice(0, 8);
    if (terms.length === 0) return [];

    const termFilters: Prisma.KbArticleWhereInput[] = terms.flatMap((t) => [
      { title: { contains: t, mode: 'insensitive' as const } },
      { summary: { contains: t, mode: 'insensitive' as const } },
      { content: { contains: t, mode: 'insensitive' as const } },
    ]);

    try {
      const rows = await this.prisma.kbArticle.findMany({
        where: {
          AND: [
            { status: KbArticleStatus.PUBLISHED },
            this.visibilityWhere(user),
            { OR: termFilters },
          ],
        },
        select: { id: true, title: true, slug: true, summary: true },
        orderBy: [{ viewCount: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
      });
      return rows;
    } catch {
      return [];
    }
  }

  async createArticle(payload: CreateKbArticleDto, user: AuthUser) {
    this.ensureAuthor(user);
    if (payload.categoryId) {
      await this.ensureCategory(payload.categoryId);
    }
    const slug = await this.uniqueArticleSlug(payload.slug ?? payload.title);

    const created = await this.prisma.kbArticle.create({
      data: {
        title: payload.title,
        slug,
        summary: payload.summary ?? null,
        content: payload.content,
        status:
          payload.status === 'PUBLISHED'
            ? KbArticleStatus.PUBLISHED
            : KbArticleStatus.DRAFT,
        isInternal: payload.isInternal ?? false,
        categoryId: payload.categoryId ?? null,
        authorId: user.id,
      },
      select: ARTICLE_LIST_SELECT,
    });
    await this.safePublishAdminChanged('created', created.id, user.id);
    return created;
  }

  async updateArticle(id: string, payload: UpdateKbArticleDto, user: AuthUser) {
    this.ensureAuthor(user);
    const existing = await this.prisma.kbArticle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Article not found');
    }
    if (payload.categoryId) {
      await this.ensureCategory(payload.categoryId);
    }

    const slug =
      payload.slug && payload.slug !== existing.slug
        ? await this.uniqueArticleSlug(payload.slug, id)
        : undefined;

    const updated = await this.prisma.kbArticle.update({
      where: { id },
      data: {
        title: payload.title,
        slug,
        summary: payload.summary === undefined ? undefined : payload.summary,
        content: payload.content,
        status:
          payload.status === undefined
            ? undefined
            : payload.status === 'PUBLISHED'
              ? KbArticleStatus.PUBLISHED
              : KbArticleStatus.DRAFT,
        isInternal: payload.isInternal,
        categoryId:
          payload.categoryId === undefined ? undefined : payload.categoryId,
      },
      select: ARTICLE_LIST_SELECT,
    });
    await this.safePublishAdminChanged('updated', updated.id, user.id);
    return updated;
  }

  async removeArticle(id: string, user: AuthUser) {
    this.ensureAuthor(user);
    const existing = await this.prisma.kbArticle.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Article not found');
    }
    await this.prisma.kbArticle.delete({ where: { id } });
    await this.safePublishAdminChanged('deleted', id, user.id);
    return { id };
  }

  // ─── Categories ──────────────────────────────────────────────────────────────

  async listCategories(query: ListKbCategoriesDto, user: AuthUser) {
    const includeInactive = Boolean(query.includeInactive) && this.canAuthor(user);
    const data = await this.prisma.kbCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { articles: true } } },
    });
    return { data };
  }

  async createCategory(payload: CreateKbCategoryDto, user: AuthUser) {
    this.ensureAuthor(user);
    const slug = await this.uniqueCategorySlug(payload.slug ?? payload.name);
    const created = await this.prisma.kbCategory.create({
      data: {
        name: payload.name,
        slug,
        description: payload.description ?? null,
        sortOrder: payload.sortOrder ?? 0,
        isActive: payload.isActive ?? true,
      },
    });
    await this.safePublishAdminChanged('created', created.id, user.id);
    return created;
  }

  async updateCategory(id: string, payload: UpdateKbCategoryDto, user: AuthUser) {
    this.ensureAuthor(user);
    const existing = await this.prisma.kbCategory.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Category not found');
    }
    const slug =
      payload.slug && payload.slug !== existing.slug
        ? await this.uniqueCategorySlug(payload.slug, id)
        : undefined;
    const updated = await this.prisma.kbCategory.update({
      where: { id },
      data: {
        name: payload.name,
        slug,
        description:
          payload.description === undefined ? undefined : payload.description,
        sortOrder: payload.sortOrder,
        isActive: payload.isActive,
      },
    });
    await this.safePublishAdminChanged('updated', updated.id, user.id);
    return updated;
  }

  async removeCategory(id: string, user: AuthUser) {
    this.ensureAuthor(user);
    const existing = await this.prisma.kbCategory.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Category not found');
    }
    // Articles keep existing (categoryId set null via FK) — safe to delete.
    await this.prisma.kbCategory.delete({ where: { id } });
    await this.safePublishAdminChanged('deleted', id, user.id);
    return { id };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async ensureCategory(id: string) {
    const category = await this.prisma.kbCategory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  private slugify(value: string) {
    return (
      value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '')
        .slice(0, 80) || 'untitled'
    );
  }

  private async uniqueArticleSlug(base: string, excludeId?: string) {
    const root = this.slugify(base);
    let slug = root;
    for (let i = 2; i < 100; i += 1) {
      const clash = await this.prisma.kbArticle.findFirst({
        where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
      });
      if (!clash) return slug;
      slug = `${root}-${i}`;
    }
    return `${root}-${Date.now()}`;
  }

  private async uniqueCategorySlug(base: string, excludeId?: string) {
    const root = this.slugify(base);
    let slug = root;
    for (let i = 2; i < 100; i += 1) {
      const clash = await this.prisma.kbCategory.findFirst({
        where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
      });
      if (!clash) return slug;
      slug = `${root}-${i}`;
    }
    return `${root}-${Date.now()}`;
  }

  private async safePublishAdminChanged(
    action: string,
    entityId: string | null,
    actorId: string | null,
  ) {
    try {
      await this.realtime.publishAdminChanged({
        scope: 'kb',
        action,
        entityId,
        teamId: null,
        actorId,
      });
    } catch {
      // Best-effort realtime publish.
    }
  }
}
