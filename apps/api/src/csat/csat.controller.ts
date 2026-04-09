import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { CsatService } from './csat.service';
import { SubmitCsatDto } from './dto/submit-csat.dto';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

@Controller('csat')
export class CsatController {
  constructor(private readonly csatService: CsatService) {}

  @Post()
  async submit(
    @Body() dto: SubmitCsatDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.csatService.submit(dto, user);
  }

  @Get(':ticketId')
  async get(@Param('ticketId') ticketId: string) {
    const data = await this.csatService.getForTicket(ticketId);
    return { data };
  }
}
