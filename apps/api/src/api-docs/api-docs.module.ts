import { Global, Module } from '@nestjs/common';
import { ApiDocsController } from './api-docs.controller';
import { ApiDocsStore } from './api-docs.store';

/**
 * The generated API description (card 2.6).
 *
 * `@Global` so `main.ts` can resolve `ApiDocsStore` from the application
 * context to hand it the document after generation, without another module
 * importing this one.
 */
@Global()
@Module({
  controllers: [ApiDocsController],
  providers: [ApiDocsStore],
  exports: [ApiDocsStore],
})
export class ApiDocsModule {}
