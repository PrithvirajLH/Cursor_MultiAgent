import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { CustomFieldsService } from './custom-fields.service';
import { CreateCustomFieldDto } from './dto/create-custom-field.dto';
import { ListCustomFieldsDto } from './dto/list-custom-fields.dto';
import { SetTicketCustomValuesDto } from './dto/set-ticket-custom-values.dto';
import { UpdateCustomFieldDto } from './dto/update-custom-field.dto';

@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly customFieldsService: CustomFieldsService) {}

  @Get()
  list(@Query() query: ListCustomFieldsDto, @CurrentUser() user: AuthUser) {
    return this.customFieldsService.list(query, user);
  }

  @Post()
  create(@Body() dto: CreateCustomFieldDto, @CurrentUser() user: AuthUser) {
    return this.customFieldsService.create(dto, user);
  }

  @Patch('tickets/:ticketId/values')
  setTicketValues(
    @Param('ticketId') ticketId: string,
    @Body() payload: SetTicketCustomValuesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.customFieldsService.setTicketValues(ticketId, payload, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomFieldDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.customFieldsService.update(id, dto, user);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.customFieldsService.delete(id, user);
  }
}
