/** The five placeholders card 1.7 specifies, plus two back-compatible aliases. */
type MacroVarSources = {
  readonly ticket: {
    readonly displayId: string | null;
    readonly subject: string;
  };
  readonly requester: {
    readonly displayName?: string | null;
    readonly email?: string | null;
  } | null;
  readonly actor: {
    readonly displayName?: string | null;
    readonly email?: string | null;
  };
};

/** No name anywhere? Then a greeting still has to read like a sentence. */
const NAME_FALLBACK = 'there';

function nameOf(
  person: { displayName?: string | null; email?: string | null } | null,
): string {
  const display = person?.displayName?.trim();
  if (display) return display;
  // The local part of an address beats an empty greeting, and beats the raw
  // address - "Hi bhavesh," reads better than "Hi bhavesh.patel@company.com,".
  const local = person?.email?.trim().split('@')[0]?.trim();
  if (local) return local;
  return NAME_FALLBACK;
}

function firstNameOf(
  person: { displayName?: string | null; email?: string | null } | null,
): string {
  const full = nameOf(person);
  const first = full.split(/\s+/)[0]?.trim();
  return first && first !== '' ? first : NAME_FALLBACK;
}

/**
 * Build the `vars` record a macro's text is filled from (card 1.7 §4).
 *
 * Handed straight to `fillTemplateVars`, which is the ONE templating function
 * in this system — the rule engine's emails already use it. A second one would
 * drift, and the drifting copy would be the one facing requesters. (That had
 * already happened: `CannedResponsePicker.tsx` carried its own client-side
 * substitution using different key names entirely. Card 1.7 deletes it.)
 *
 * Every value here is non-empty by construction, because an empty name makes a
 * broken sentence — "Hi ," is worse than "Hi there,". Keys NOT listed here
 * still resolve to an empty string, which is `fillTemplateVars`' own rule and
 * is what stops a typo leaking a raw `{{...}}` into a customer's inbox.
 *
 * Nothing here is escaped, and that is correct: the output goes into a message
 * body that the message pipeline escapes at render time. Escaping twice would
 * show `&amp;` to a requester.
 */
export function buildMacroVars(
  sources: MacroVarSources,
): Record<string, string> {
  const reference = sources.ticket.displayId ?? '';
  return {
    'requester.firstName': firstNameOf(sources.requester),
    'requester.displayName': nameOf(sources.requester),
    'ticket.displayId': reference,
    'ticket.subject': sources.ticket.subject,
    'agent.firstName': firstNameOf(sources.actor),
    // Back-compatible aliases for templates written against the old web-side
    // substitution, so this card does not silently empty them. `ticket.id`
    // used to interpolate the raw UUID, which is useless in a reply, so it now
    // resolves to the reference people actually quote.
    'ticket.id': reference,
    'requester.name': nameOf(sources.requester),
  };
}
