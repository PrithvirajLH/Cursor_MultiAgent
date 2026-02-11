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
import { TeamAdminOrOwnerGuard } from '../auth/team-admin-or-owner.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { TestRuleDto } from './dto/test-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';
import { AutomationService } from './automation.service';

@Controller('automation-rules')
@UseGuards(TeamAdminOrOwnerGuard)
export class AutomationRulesController {
  constructor(private readonly automationService: AutomationService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.automationService.list(user);
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.automationService.getOne(id, user);
  }

  @Get(':id/executions')
  async getExecutions(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.automationService.getExecutions(id, user, p, ps);
  }

  @Post()
  async create(
    @Body() payload: CreateAutomationRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.automationService.create(payload, user);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() payload: UpdateAutomationRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.automationService.update(id, payload, user);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.automationService.remove(id, user);
  }

  /** Dry-run: evaluate rule against a ticket. No side effects; enforces ticket access (same as get ticket). */
  @Post(':id/test')
  async test(
    @Param('id') id: string,
    @Body() body: TestRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!body.ticketId) {
      return { matched: false, actionsThatWouldRun: [], message: 'Provide ticketId to test against a ticket.' };
    }
    const result = await this.automationService.evaluateRuleForTicket(id, body.ticketId, user);
    return {
      matched: result.matched,
      actionsThatWouldRun: result.actionsThatWouldRun,
      message: result.message ?? (result.matched ? 'Rule would run.' : 'Rule did not match.'),
    };
  }
}
