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

  /**
   * ⚠️ CARD 1.79: `@CurrentUser` HERE IS THE FIX. Without it this endpoint
   * served any ticket's rating and comment to anybody signed in - and the
   * `@Post` beside it has always taken the caller.
   */
  @Get(':ticketId')
  async get(
    @Param('ticketId') ticketId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const data = await this.csatService.getForTicket(ticketId, user);
    return { data };
  }
}
