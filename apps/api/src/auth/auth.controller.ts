import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrentUser, type AuthUser } from './current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SyncProfileDto } from './dto/sync-profile.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { data: user };
  }

  @Patch('profile')
  async syncProfile(
    @CurrentUser() user: AuthUser,
    @Body() payload: SyncProfileDto,
  ) {
    const updateData: Prisma.UserUpdateInput = {};
    const graphProfile = payload.graphProfile;

    if (graphProfile !== undefined) {
      if (graphProfile === null) {
        updateData.graphProfile = Prisma.JsonNull;
      } else {
        updateData.graphProfile = graphProfile as Prisma.InputJsonValue;
      }

      const displayName = this.readString(graphProfile, 'displayName');
      if (displayName) {
        updateData.displayName = displayName;
      }

      const department = this.readString(graphProfile, 'department');
      if (department !== null) {
        updateData.department = department;
      }

      const officeLocation = this.readString(graphProfile, 'officeLocation');
      if (officeLocation !== null) {
        updateData.location = officeLocation;
      }
    }

    if (Object.keys(updateData).length === 0) {
      const current = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          displayName: true,
          department: true,
          location: true,
          graphProfile: true,
        },
      });
      return { data: current };
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        displayName: true,
        department: true,
        location: true,
        graphProfile: true,
      },
    });
    return { data: updated };
  }

  private hasProperty(
    value: unknown,
    key: string,
  ): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && key in value;
  }

  private readString(value: unknown, key: string) {
    if (!this.hasProperty(value, key)) {
      return null;
    }
    const raw = value[key];
    if (typeof raw !== 'string') {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
