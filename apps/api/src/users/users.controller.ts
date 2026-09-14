import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(@Query() query: ListUsersDto, @CurrentUser() actor: AuthUser) {
    return this.usersService.list(query, actor);
  }

  /**
   * Card 2.2. Declared before the `:id` routes so "me" is never read as an id -
   * the same ordering rule as `export.csv` on the tickets controller.
   */
  @Get('me/availability')
  async getMyAvailability(@CurrentUser() actor: AuthUser) {
    return this.usersService.getAvailability(actor);
  }

  @Patch('me/availability')
  async setMyAvailability(
    @Body() payload: UpdateAvailabilityDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.usersService.setAvailability(actor, payload);
  }

  @Patch(':id/role')
  async updateRole(
    @Param('id') id: string,
    @Body() payload: UpdateUserRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can update user roles');
    }
    return this.usersService.updateRole(id, payload, actor);
  }

  @Get(':id/deactivation-preview')
  async deactivationPreview(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.usersService.deactivationPreview(id, actor);
  }

  @Post(':id/deactivate')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.usersService.deactivate(id, actor);
  }

  /**
   * Card 1.98. Two routes, because restoring is a DECISION: the owner looks at
   * what the person had, then asks for it back. Reactivation alone leaves them
   * on no team, which is what happens today.
   */
  @Get(':id/restorable-teams')
  async restorableTeams(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.usersService.restorableTeams(id, actor);
  }

  @Post(':id/restore-teams')
  async restoreTeams(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.usersService.restoreTeams(id, actor);
  }

  @Post(':id/reactivate')
  async reactivate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.usersService.reactivate(id, actor);
  }

  @Patch(':id/primary-team')
  async setPrimaryTeam(
    @Param('id') id: string,
    @Body() payload: { primaryTeamId: string | null },
    @CurrentUser() actor: AuthUser,
  ) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can change primary team');
    }
    return this.usersService.setPrimaryTeam(id, payload?.primaryTeamId ?? null, actor);
  }
}
