import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { TeamAdminOrOwnerGuard } from '../auth/team-admin-or-owner.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ListAuditLogDto } from './dto/list-audit-log.dto';
import { AuditService } from './audit.service';

@Controller('audit-log')
@UseGuards(TeamAdminOrOwnerGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(@Query() query: ListAuditLogDto, @CurrentUser() user: AuthUser) {
    const parsedPage = Number.parseInt(query.page ?? '', 10);
    const parsedPageSize = Number.parseInt(query.pageSize ?? '', 10);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const pageSize =
      Number.isFinite(parsedPageSize) && parsedPageSize > 0
        ? parsedPageSize
        : 20;
    return this.auditService.list(
      {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        userId: query.userId,
        type: query.type,
        search: query.search,
        page,
        pageSize,
      },
      user,
    );
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  async exportCsv(
    @Query() query: ListAuditLogDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const csv = await this.auditService.exportCsv(
      {
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        userId: query.userId,
        type: query.type,
        search: query.search,
      },
      user,
    );
    res.send(csv);
  }
}
