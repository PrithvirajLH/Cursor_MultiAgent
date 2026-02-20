import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
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
}
