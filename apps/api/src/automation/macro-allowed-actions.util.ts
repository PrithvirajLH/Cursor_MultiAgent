/**
 * The only actions a MACRO may carry (card 1.7 §2). One list, in one place.
 *
 * The rule engine supports twelve actions. A macro is a button a human clicks,
 * so it deliberately gets fewer:
 *
 *   send_email        NO - a one-click button that emails an arbitrary address.
 *   notify_requester  NO - reaches a requester with no agent reading what went out.
 *   notify_team_lead  NO - same.
 *
 * Card 1.42 deleted most of this system's email precisely to stop noise; a macro
 * that sends email puts it straight back through a side door, which is why the
 * refusal is enforced server-side on SAVE and again on EXECUTE. A macro stored
 * before this list existed, or edited through a stale client, still cannot send.
 *
 * `add_internal_note` IS allowed, and that was a judgement call. It writes into
 * the conversation, but card 1.42 established that an internal note emails
 * nobody at all and is visible only to staff in the app - so it adds no noise,
 * and "standard password reset performed" is exactly the sort of record a macro
 * should be able to leave. It is one entry in this array to reverse.
 *
 * ⚠️ If you add an action to the rule engine, you must decide consciously
 * whether it belongs here. That is why this list is explicit rather than derived
 * by subtraction from ACTION_TYPES.
 */
export const MACRO_ALLOWED_ACTIONS: readonly string[] = [
  'set_status',
  'set_priority',
  'set_category',
  'add_tag',
  'remove_tag',
  'assign_user',
  'assign_team',
  'add_follower',
  'add_internal_note',
];
