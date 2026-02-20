import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ListSlasDto } from './dto/list-slas.dto';
import {
  CreateSlaPolicyConfigDto,
  UpdateSlaPolicyConfigDto,
} from './dto/policy-config.dto';
import { UpdateSlaBusinessHoursDto } from './dto/sla-business-hours.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla.dto';
import { SlasService } from './slas.service';

@Controller('slas')
export class SlasController {
  constructor(private readonly slasService: SlasService) {}

  @Get()
  async list(@Query() query: ListSlasDto, @CurrentUser() user: AuthUser) {
    return this.slasService.list(query, user);
  }

  @Put(':teamId')
  async update(
    @Param('teamId') teamId: string,
    @Body() payload: UpdateSlaPolicyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.slasService.update(teamId, payload, user);
  }

  @Delete(':teamId')
  async reset(@Param('teamId') teamId: string, @CurrentUser() user: AuthUser) {
    return this.slasService.reset(teamId, user);
  }

  @Get('policies')
  async listPolicyConfigs(@CurrentUser() user: AuthUser) {
    return this.slasService.listPolicyConfigs(user);
  }

  @Post('policies')
  async createPolicyConfig(
    @Body() payload: CreateSlaPolicyConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.slasService.createPolicyConfig(payload, user);
  }

  @Patch('policies/:policyId')
  async updatePolicyConfig(
    @Param('policyId') policyId: string,
    @Body() payload: UpdateSlaPolicyConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.slasService.updatePolicyConfig(policyId, payload, user);
  }

  @Delete('policies/:policyId')
  async deletePolicyConfig(
    @Param('policyId') policyId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.slasService.deletePolicyConfig(policyId, user);
  }

  @Get('settings')
  async getBusinessHoursSettings(@CurrentUser() user: AuthUser) {
    return this.slasService.getBusinessHoursSettings(user);
  }

  @Patch('settings')
  async updateBusinessHoursSettings(
    @Body() payload: UpdateSlaBusinessHoursDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.slasService.updateBusinessHoursSettings(payload, user);
  }
}
