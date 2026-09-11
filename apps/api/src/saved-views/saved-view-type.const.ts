/**
 * The two kinds of saved view (card 1.60).
 *
 * ⚠️ THIS IS THE ONLY PLACE THE DISCRIMINATOR IS SPELLED. It used to live as a
 * key inside `SavedView.filters` written by the Reports page and read by two
 * other places, and card 1.60 promoted it to a real column. The whole point of
 * that change was ONE source of truth, so the allowed values are named here and
 * imported rather than retyped into each DTO — a literal union in three files
 * is the same drift in a smaller font.
 *
 * `tickets` is the default because it is the overwhelming majority and because
 * a ticket view never carried the old JSON key at all, which is what made an
 * expression index over the JSON unworkable: `filters->>'viewType'` is NULL for
 * every one of them, and a unique index treats NULLs as distinct.
 */
export const SAVED_VIEW_TYPES = ['tickets', 'reports'] as const;
