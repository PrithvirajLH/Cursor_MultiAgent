import { Prisma } from '@prisma/client';

/**
 * Read a ticket reference that may be either form (card 2.12).
 *
 * `/tickets/7fe5d219-…` is unrecognisable in Teams and in email, and every
 * ticket already carries a `displayId` like `IT-0042`. Both now resolve.
 *
 * ⚠️ THE FORM IS DECIDED BY SHAPE, NOT BY A LOOKUP THAT FALLS BACK. "Try the
 * id, and if that misses try the display id" would double the cost of the
 * hottest read in the application for every miss — and a miss is exactly what a
 * display-id link produces. A UUID cannot collide with a display id
 * (`IT-0042`), so the shape is enough to know which column to ask about.
 *
 * `displayId` is nullable in the schema even though every production row has
 * one, which is why nothing here may assume it exists.
 *
 * @param reference A ticket UUID or a display id.
 * @returns The `where` clause naming whichever unique column this is.
 */
export function ticketRefWhere(
  reference: string,
): Prisma.TicketWhereUniqueInput {
  return isUuid(reference) ? { id: reference } : { displayId: reference };
}

/** Canonical UUID shape, any version. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
