import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { CreateCannedResponseDto } from './dto/create-canned-response.dto';
import { UpdateCannedResponseDto } from './dto/update-canned-response.dto';

@Injectable()
export class CannedResponsesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    const orConditions: Array<{ userId: string } | { teamId: string }> = [
      { userId: user.id },
    ];
    if (user.teamId) {
      orConditions.push({ teamId: user.teamId });
    }
    const items = await this.prisma.cannedResponse.findMany({
      where: { OR: orConditions },
      orderBy: { name: 'asc' },
    });
    return { data: items };
  }

  async create(dto: CreateCannedResponseDto, user: AuthUser) {
    const teamId =
      dto.teamId != null && user.teamId != null && dto.teamId === user.teamId
        ? dto.teamId
        : null;
    const item = await this.prisma.cannedResponse.create({
      data: {
        name: dto.name,
        content: dto.content,
        userId: user.id,
        teamId,
      },
    });
    return item;
  }

  async update(id: string, dto: UpdateCannedResponseDto, user: AuthUser) {
    const existing = await this.prisma.cannedResponse.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Canned response not found');
    }
    if (existing.userId !== user.id) {
      throw new ForbiddenException(
        'You can only edit your own canned responses',
      );
    }
    const item = await this.prisma.cannedResponse.update({
      where: { id },
      data: {
        ...(dto.name != null && { name: dto.name }),
        ...(dto.content != null && { content: dto.content }),
      },
    });
    return item;
  }

  async delete(id: string, user: AuthUser) {
    const existing = await this.prisma.cannedResponse.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Canned response not found');
    }
    if (existing.userId !== user.id) {
      throw new ForbiddenException(
        'You can only delete your own canned responses',
      );
    }
    await this.prisma.cannedResponse.delete({ where: { id } });
    return { deleted: true };
  }
}
