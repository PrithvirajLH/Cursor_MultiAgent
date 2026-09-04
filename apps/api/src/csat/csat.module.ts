import { Module } from '@nestjs/common';
import { CsatController } from './csat.controller';
import { CsatService } from './csat.service';

@Module({
  controllers: [CsatController],
  providers: [CsatService],
  // Exported for card 1.44's one-click rating, which calls this service beside
  // the authenticated endpoint rather than loosening it.
  exports: [CsatService],
})
export class CsatModule {}
