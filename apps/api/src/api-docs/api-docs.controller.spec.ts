import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { OwnerGuard } from '../auth/owner.guard';
import { ApiDocsController } from './api-docs.controller';
import { ApiDocsStore } from './api-docs.store';

/** A request context carrying whatever role the test wants to present. */
function contextFor(role: UserRole | null): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => (role === null ? {} : { user: { id: 'u1', role } }),
    }),
  } as unknown as ExecutionContext;
}

/**
 * Card 2.6 — the API description, and who may read it.
 *
 * ⚠️ THE GUARD IS THE POINT OF THIS FILE. `/api/docs` is a complete map of every
 * route, parameter and response shape in the product, including the admin
 * endpoints an agent cannot call. It is served from a CONTROLLER rather than
 * `SwaggerModule.setup()` precisely so the ordinary guards apply; if that ever
 * regresses to a mounted express handler, the guard silently stops running and
 * nothing else in the suite would notice.
 */
describe('the API description is owner-only (card 2.6)', () => {
  const guard = new OwnerGuard();

  it('⚠️ refuses an AGENT', () => {
    expect(() => guard.canActivate(contextFor(UserRole.AGENT))).toThrow(
      ForbiddenException,
    );
  });

  it('⚠️ refuses a TEAM_ADMIN — this is narrower than the admin screens', () => {
    // Deliberate: AdminGuard would let a team admin in, and this document names
    // every route in the product rather than one team's data.
    expect(() => guard.canActivate(contextFor(UserRole.TEAM_ADMIN))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses a request with no resolved user', () => {
    expect(() => guard.canActivate(contextFor(null))).toThrow(ForbiddenException);
  });

  it('allows an OWNER', () => {
    // The non-vacuity half. A guard that refused everyone would pass the three
    // assertions above and make the endpoint useless.
    expect(guard.canActivate(contextFor(UserRole.OWNER))).toBe(true);
  });
});

describe('the API description is served from the generated document (card 2.6)', () => {
  it('returns the document bootstrap handed it', () => {
    const store = new ApiDocsStore();
    store.set({ openapi: '3.0.0', paths: { '/api/tickets': {} } });
    const body = new ApiDocsController(store).getDocument();
    expect(body).toMatchObject({ openapi: '3.0.0' });
  });

  it('⚠️ says so when no document was generated, rather than serving an empty one', () => {
    // An empty object is valid JSON and reads like an API with no endpoints,
    // which is a far more confusing answer than a 404.
    const controller = new ApiDocsController(new ApiDocsStore());
    expect(() => controller.getDocument()).toThrow(NotFoundException);
  });
});
