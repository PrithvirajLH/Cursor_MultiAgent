import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { CreateSavedViewDto } from './dto/create-saved-view.dto';
import { UpdateSavedViewDto } from './dto/update-saved-view.dto';

@Injectable()
export class SavedViewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const orConditions: Array<{ userId: string } | { teamId: string }> = [
      { userId: user.id },
    ];
    if (user.teamId) {
      orConditions.push({ teamId: user.teamId });
    }
    const views = await this.prisma.savedView.findMany({
      where: { OR: orConditions },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return { data: views };
  }

  async create(dto: CreateSavedViewDto, user: AuthUser) {
    const teamId =
      dto.teamId != null && user.teamId != null && dto.teamId === user.teamId
        ? dto.teamId
        : null;
    if (dto.isDefault) {
      await this.prisma.savedView.updateMany({
        where: { userId: user.id },
        data: { isDefault: false },
      });
    }
    const view = await this.prisma.savedView.create({
      data: {
        name: dto.name,
        filters: dto.filters as object,
        isDefault: dto.isDefault ?? false,
        userId: user.id,
        teamId,
      },
    });
    return view;
  }

  async update(id: string, dto: UpdateSavedViewDto, user: AuthUser) {
    const existing = await this.prisma.savedView.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Saved view not found');
    }
    if (existing.userId !== user.id) {
      throw new ForbiddenException('You can only edit your own saved views');
    }
    if (dto.isDefault === true) {
      await this.prisma.savedView.updateMany({
        where: { userId: user.id },
        data: { isDefault: false },
      });
    }
    const view = await this.prisma.savedView.update({
      where: { id },
      data: {
        ...(dto.name != null && { name: dto.name }),
        ...(dto.filters != null && { filters: dto.filters as object }),
        ...(dto.isDefault != null && { isDefault: dto.isDefault }),
      },
    });
    return view;
  }

  async delete(id: string, user: AuthUser) {
    const existing = await this.prisma.savedView.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Saved view not found');
    }
    if (existing.userId !== user.id) {
      throw new ForbiddenException('You can only delete your own saved views');
    }
    await this.prisma.savedView.delete({ where: { id } });
    return { deleted: true };
  }
}
