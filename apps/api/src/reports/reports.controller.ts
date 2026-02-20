import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ReportQueryDto, ResolutionTimeQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(AdminGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  getSummary(@Query() query: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reportsService.getSummary(query, user);
  }

  @Get('ticket-volume')
  getTicketVolume(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reportsService.getTicketVolume(query, user);
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
}
