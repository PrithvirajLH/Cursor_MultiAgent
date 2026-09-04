import {
  Controller,
  Get,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Readable } from 'stream';
import { LeadOrAdminGuard } from '../auth/lead-or-admin.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ReportQueryDto, ResolutionTimeQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(LeadOrAdminGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  getSummary(@Query() query: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reportsService.getSummary(query, user);
  }

  @Get('ai-accuracy')
  getAiAccuracy(@Query() query: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reportsService.getAiAccuracy(query, user);
  }

  @Get('tag-analytics')
  getTagAnalytics(
    @Query('days') daysRaw: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = daysRaw ? Number.parseInt(daysRaw, 10) : 30;
    const days = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 365)
      : 30;
    return this.reportsService.getTagAnalytics(days, user);
  }

  @Get('ticket-volume')
  getTicketVolume(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getTicketVolume(query, user);
  }

  /**
   * The three desk metrics card 1.17 found missing from the other 22 reports.
   *
   * Same guard, same DTO, same scoping as every report above: LeadOrAdminGuard
   * on the controller and `scopeReportQuery` inside the service, which fails
   * closed for any role it does not name.
   */
  @Get('first-contact-resolution')
  getFirstContactResolution(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getFirstContactResolution(query, user);
  }

  @Get('reassignment-count')
  getReassignmentCount(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getReassignmentCount(query, user);
  }

  @Get('time-in-status')
  getTimeInStatus(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getTimeInStatus(query, user);
  }

  @Get('sla-compliance')
  getSlaCompliance(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getSlaCompliance(query, user);
  }

  @Get('sla-compliance-by-priority')
  getSlaComplianceByPriority(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getSlaComplianceByPriority(query, user);
  }

  @Get('sla-compliance-by-team')
  getSlaComplianceByTeam(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getSlaComplianceByTeam(query, user);
  }

  @Get('resolution-time')
  getResolutionTime(
    @Query() query: ResolutionTimeQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getResolutionTime(query, user);
  }

  @Get('tickets-by-status')
  getTicketsByStatus(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getTicketsByStatus(query, user);
  }

  @Get('tickets-by-priority')
  getTicketsByPriority(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getTicketsByPriority(query, user);
  }

  @Get('agent-performance')
  getAgentPerformance(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getAgentPerformance(query, user);
  }

  @Get('agent-workload')
  getAgentWorkload(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getAgentWorkload(query, user);
  }

  @Get('tickets-by-age')
  getTicketsByAge(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getTicketsByAge(query, user);
  }

  @Get('reopen-rate')
  getReopenRate(@Query() query: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reportsService.getReopenRate(query, user);
  }

  @Get('csat-trend')
  getCsatTrend(@Query() query: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reportsService.getCsatTrend(query, user);
  }

  @Get('csat-drivers')
  getCsatDrivers(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getCsatDrivers(query, user);
  }

  @Get('csat-low-tags')
  getCsatLowTags(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getCsatLowTags(query, user);
  }

  @Get('sla-breaches')
  getSlaBreaches(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getSlaBreaches(query, user);
  }

  @Get('channel-breakdown')
  getChannelBreakdown(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getChannelBreakdown(query, user);
  }

  @Get('tickets-by-category')
  getTicketsByCategory(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getTicketsByCategory(query, user);
  }

  @Get('team-summary')
  getTeamSummary(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getTeamSummary(query, user);
  }

  @Get('transfers')
  getTransfers(@Query() query: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reportsService.getTransfers(query, user);
  }

  // Declared after every fixed route so ':report' cannot swallow them.
  @Get(':report/export.csv')
  async exportCsv(
    @Param('report') report: string,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const csv = await this.reportsService.exportCsv(report, query, user);
    const stamp = new Date().toISOString().slice(0, 10);
    return new StreamableFile(Readable.from([csv]), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="report-${report}-${stamp}.csv"`,
    });
  }
}
