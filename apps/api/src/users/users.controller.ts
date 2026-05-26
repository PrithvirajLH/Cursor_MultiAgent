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
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(@Query() query: ListUsersDto, @CurrentUser() actor: AuthUser) {
    return this.usersService.list(query, actor);
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
