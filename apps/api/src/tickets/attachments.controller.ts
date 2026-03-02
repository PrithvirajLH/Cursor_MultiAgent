import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { UpdateAttachmentScanDto } from './dto/update-attachment-scan.dto';
import { TicketsService } from './tickets.service';

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get(':id')
  async download(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const { attachment, stream } = await this.ticketsService.getAttachmentFile(
      id,
      user,
    );
    const safeName = attachment.fileName.replace(/"/g, '');
    return new StreamableFile(stream, {
      type: attachment.contentType,
      disposition: `attachment; filename="${safeName}"`,
      length: attachment.sizeBytes,
    });
  }

  @Post(':id/scan-status')
  @Public()
  async updateScanStatus(
    @Param('id') id: string,
    @Body() payload: UpdateAttachmentScanDto,
    @Headers('x-attachment-scan-secret') scannerSecret: string | undefined,
  ) {
    return this.ticketsService.updateAttachmentScanStatus(
      id,
      payload,
      scannerSecret,
    );
  }
}
