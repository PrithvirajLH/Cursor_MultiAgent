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
    try {
      const { attachment, stream } =
        await this.ticketsService.getAttachmentFile(id, user);
      // #region agent log
      fetch(
        'http://127.0.0.1:7686/ingest/6a1f3111-6cf9-40cd-acd5-d937fa5a14be',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': 'e8c120',
          },
          body: JSON.stringify({
            sessionId: 'e8c120',
            location: 'attachments.controller.ts:download',
            message: 'before StreamableFile',
            data: { attachmentId: id },
            timestamp: Date.now(),
            hypothesisId: 'H3',
          }),
        },
      ).catch(() => {});
      // #endregion
      const safeName = attachment.fileName.replace(/"/g, '');
      return new StreamableFile(stream, {
        type: attachment.contentType,
        disposition: `attachment; filename="${safeName}"`,
        length: attachment.sizeBytes,
      });
    } catch (err) {
      // #region agent log
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      fetch(
        'http://127.0.0.1:7686/ingest/6a1f3111-6cf9-40cd-acd5-d937fa5a14be',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': 'e8c120',
          },
          body: JSON.stringify({
            sessionId: 'e8c120',
            location: 'attachments.controller.ts:download',
            message: 'download error',
            data: { error: message, stack },
            timestamp: Date.now(),
            hypothesisId: 'H_ERR',
          }),
        },
      ).catch(() => {});
      // #endregion
      throw err;
    }
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
