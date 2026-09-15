import {
  Controller,
  Get,
  Header,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { OwnerGuard } from '../auth/owner.guard';
import { ApiDocsStore } from './api-docs.store';

/**
 * `GET /api/docs` — the OpenAPI description of this API (card 2.6).
 *
 * ⚠️ **OWNER ONLY, and it goes through the ordinary guards.** This is a complete
 * map of every route, parameter and response shape in the product; it names
 * admin endpoints an agent cannot call and would tell a curious account exactly
 * where to push. `OwnerGuard` runs after `AuthGuard`, so an anonymous caller
 * gets 401 and a signed-in non-owner gets 403, with no auth logic written twice.
 *
 * ⚠️ **THE INTERACTIVE SWAGGER UI IS DELIBERATELY NOT MOUNTED**, and the reason
 * is this app's own CSP. `main.ts` sets `scriptSrc: ["'self'", <one hash>]`;
 * swagger-ui injects its own inline bootstrap script, so serving it means either
 * adding `'unsafe-inline'` or hashing a vendor script that changes on every
 * upgrade. Punching that hole in the policy, on the one page that maps the
 * entire API, is a bad trade for a convenience. The document below is plain
 * OpenAPI 3 — point any viewer at it (Swagger UI, Redoc, Insomnia, Bruno) and
 * get the same thing without relaxing the policy that protects the SPA.
 */
@Controller('docs')
@UseGuards(OwnerGuard)
export class ApiDocsController {
  constructor(private readonly store: ApiDocsStore) {}

  /** The OpenAPI 3 document describing every route the app exposes. */
  @Get()
  @Header('Cache-Control', 'no-store')
  getDocument(): Record<string, unknown> {
    const document = this.store.get();
    if (!document) {
      // Bootstrap generates it; a test harness that builds the module directly
      // never does. Saying so beats serving an empty object that reads like a
      // documented API with no endpoints.
      throw new NotFoundException(
        'The API description was not generated for this process',
      );
    }
    return document;
  }
}
