/** The shape the carousel needs from an attachment — a subset of the API type. */
type CarouselAttachment = { id: string; contentType: string };

/** Where the viewer is in a ticket's images, and where it can go next. */
export type AttachmentCarousel<T extends CarouselAttachment> = {
  /** Only the attachments that can actually be previewed, in server order. */
  images: T[];
  /** Position of the open attachment among `images`; -1 when it is not an image. */
  index: number;
  /** How many images the ticket has. NOT how many files. */
  total: number;
  /** The image before this one, or null at the start. */
  prevId: string | null;
  /** The image after this one, or null at the end. */
  nextId: string | null;
};

/**
 * Work out the carousel's state for a ticket (card 1.117).
 *
 * ⚠️ IT COUNTS IMAGES, NOT FILES. A ticket with six photos and a PDF is "1 of 6
 * images", never "1 of 7" — a count that promises a seventh picture and then
 * refuses to show it is worse than no count.
 *
 * ⚠️ IT STEPS THROUGH THE SERVER'S OWN LIST AND NOTHING ELSE. Card 1.83 made the
 * API decide, per viewer, which attachments a person may see — a file pasted
 * into an internal note is absent from a requester's copy. So `prevId`/`nextId`
 * are only ever ids taken FROM the array that was handed in. Nothing here
 * constructs an id, guesses a neighbour, or offsets one. The download route
 * would refuse an invented id anyway, but a viewer that asks for files its own
 * list does not contain is pointed straight at what that card just fixed.
 *
 * ⚠️ IT RETURNS ONE ID PER DIRECTION, NEVER A RANGE, AND THAT IS DELIBERATE.
 * Card 3.5 made every `GET /attachments/:id` write an audit row naming the file
 * and the person, so the log answers "who opened this". Handing the caller a
 * list to preload would put rows in that log for files nobody looked at, and the
 * log would then record what the software fetched rather than what a person saw
 * — worse than no log, because people would still trust it. A single id is the
 * shape that makes prefetching awkward to write by accident.
 *
 * ⚠️ THE ENDS STOP, THEY DO NOT WRAP. `null` means the arrow is disabled. On a
 * ticket of seven near-identical photos, wrapping silently back to the first is
 * indistinguishable from the arrow not working.
 *
 * @param attachments The ticket's attachments, exactly as the server returned them.
 * @param currentId The attachment being previewed, or null when none is open.
 */
export function attachmentCarousel<T extends CarouselAttachment>(
  attachments: readonly T[],
  currentId: string | null,
): AttachmentCarousel<T> {
  const images = attachments.filter((attachment) =>
    attachment.contentType.trim().toLowerCase().startsWith("image/"),
  );
  const index = currentId
    ? images.findIndex((image) => image.id === currentId)
    : -1;
  const hasPosition = index >= 0;
  return {
    images,
    index,
    total: images.length,
    prevId: hasPosition && index > 0 ? images[index - 1].id : null,
    nextId:
      hasPosition && index < images.length - 1 ? images[index + 1].id : null,
  };
}
