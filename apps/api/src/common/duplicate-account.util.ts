/** A user row this check compares against; only the fields a human needs to judge. */
export type DuplicateCandidate = {
  id: string;
  email: string;
  role: string;
};

/**
 * What the comparison thinks, and nothing more than that.
 *
 * `probable` means "worth a human looking", never "safe to merge". There is no
 * verdict that authorises a merge, deliberately — see the warning on
 * `assessProbableDuplicate`.
 */
export type DuplicateAssessment =
  | { verdict: 'none' }
  | { verdict: 'probable'; key: string; matches: DuplicateCandidate[] }
  | { verdict: 'ambiguous'; key: string; matches: DuplicateCandidate[] };

const SEPARATORS = /[._-]+/;

/** Local part and domain of an address, lowercased, or null if it is not one. */
function split(email: string): { local: string; domain: string } | null {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at <= 0) return null;
  const local = email.trim().toLowerCase().slice(0, at);
  const domain = email.trim().toLowerCase().slice(at + 1);
  if (local === '' || domain === '') return null;
  return { local, domain };
}

/**
 * The short form a separated local part would abbreviate to: first initial plus
 * surname. `prithviraj_hulgur` -> `phulgur`.
 *
 * Null when there is nothing to abbreviate, which is what makes an already-short
 * address its own key below.
 */
function shortFormOf(local: string): string | null {
  const parts = local.split(SEPARATORS).filter((part) => part !== '');
  if (parts.length < 2) return null;
  const first = parts[0];
  const surname = parts[parts.length - 1];
  if (first.length === 0 || surname.length < 2) return null;
  return `${first[0]}${surname}`;
}

/**
 * The key two addresses must share to be considered the same human.
 *
 * A long form keys to its own abbreviation; a short form keys to itself. So
 * `prithviraj_hulgur@x` and `phulgur@x` both key to `phulgur@x` — and so do
 * `john_smith@x`, `jane_smith@x` and `jsmith@x`, which is the whole reason the
 * ambiguity rule below exists.
 */
function keyOf(email: string): string | null {
  const parts = split(email);
  if (!parts) return null;
  return `${shortFormOf(parts.local) ?? parts.local}@${parts.domain}`;
}

/** True when this address is a separated long form rather than an abbreviation. */
function isLongForm(email: string): boolean {
  const parts = split(email);
  return parts !== null && shortFormOf(parts.local) !== null;
}

/**
 * Does an address about to be provisioned look like a human we already have?
 *
 * SUSPICION ONLY. Nothing here may be used to merge two rows, and there is
 * deliberately no verdict that says it is safe to. The reason is that the
 * comparison cannot tell people apart: `jsmith@` is a plausible short form of
 * BOTH `john_smith@` and `jane_smith@`, so acting on it automatically would put
 * one person's tickets — including the HR and payroll ones, and the internal
 * notes written about them — in front of somebody else. That is a worse outcome
 * than the duplicate account this is trying to surface.
 *
 * So: when more than one distinct long form shares a key, the answer is
 * `ambiguous` rather than a guess. A human decides, through
 * `merge-duplicate-user.mjs`, with both accounts printed in front of them.
 *
 * Not handled, and not silently: plus-addressing (`name+tag@`), dots-are-free
 * mailbox rules, and anything cross-domain. Each would need its own reasoning
 * about who owns the mailbox.
 */
export function assessProbableDuplicate(
  email: string,
  candidates: DuplicateCandidate[],
): DuplicateAssessment {
  const key = keyOf(email);
  if (key === null) return { verdict: 'none' };
  const incoming = email.trim().toLowerCase();

  const sharing = candidates.filter(
    (candidate) =>
      candidate.email.trim().toLowerCase() !== incoming &&
      keyOf(candidate.email) === key,
  );
  if (sharing.length === 0) return { verdict: 'none' };

  // Every distinct long form that abbreviates to this key, the incoming address
  // included. Two of them means the key cannot identify one human.
  const longForms = new Set<string>();
  if (isLongForm(incoming)) longForms.add(incoming);
  for (const candidate of sharing) {
    const address = candidate.email.trim().toLowerCase();
    if (isLongForm(address)) longForms.add(address);
  }

  return longForms.size > 1
    ? { verdict: 'ambiguous', key, matches: sharing }
    : { verdict: 'probable', key, matches: sharing };
}
