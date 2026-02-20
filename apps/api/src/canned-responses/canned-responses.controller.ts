import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { CreateCannedResponseDto } from './dto/create-canned-response.dto';
import { UpdateCannedResponseDto } from './dto/update-canned-response.dto';
import { CannedResponsesService } from './canned-responses.service';

@Controller('canned-responses')
export class CannedResponsesController {
  constructor(
    private readonly cannedResponsesService: CannedResponsesService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.cannedResponsesService.list(user);
  }

  @Post()
  create(@Body() dto: CreateCannedResponseDto, @CurrentUser() user: AuthUser) {
    return this.cannedResponsesService.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCannedResponseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cannedResponsesService.update(id, dto, user);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.cannedResponsesService.delete(id, user);
  }
}
