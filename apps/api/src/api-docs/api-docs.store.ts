import { Injectable } from '@nestjs/common';

/**
 * Holds the generated OpenAPI document so a guarded route can serve it
 * (card 2.6).
 *
 * ⚠️ WHY A STORE RATHER THAN `SwaggerModule.setup()`. The usual call mounts an
 * express handler straight onto the HTTP adapter, OUTSIDE Nest's controller
 * layer — so `AuthGuard` and `OwnerGuard` never see the request, and the only
 * ways to protect it are a second piece of auth middleware or an env flag.
 * A second identity check for a page that maps the whole API surface is exactly
 * the parallel-authorisation shape this card is told to avoid.
 *
 * The document is built once at bootstrap, where the application instance is
 * available, and handed here. `ApiDocsController` then serves it like any other
 * route, behind the same guards as everything else.
 */
@Injectable()
export class ApiDocsStore {
  private document: Record<string, unknown> | null = null;

  /** Called once from `main.ts`, after the document is generated. */
  set(document: Record<string, unknown>): void {
    this.document = document;
  }

  /**
   * The document, or null when the app was started without generating one —
   * which is the case under `ts-jest`, where bootstrap does not run.
   */
  get(): Record<string, unknown> | null {
    return this.document;
  }
}
