/**
 * Narrow a list of people by a typed query (card 1.52).
 *
 * ⚠️ MATCHES DISPLAY NAME **AND** EMAIL, and that is the point rather than a
 * nicety. Several accounts have no display name and render their raw address
 * instead — `tpitts@csnhc.com` is visible in the owner's own screenshot of this
 * dropdown — so a name-only filter makes exactly the people somebody is hunting
 * for unfindable.
 *
 * Deliberately a plain `toLowerCase().includes()` over a `useMemo`, following
 * the only search precedent in the app (`AdminTagsPage.tsx:111-113`). No
 * dependency, and there is no combobox primitive in `components/ui/` to build
 * on.
 *
 * Kept generic and free of any component so it can be lifted to the other
 * unfiltered dropdowns — `ActionEditor.tsx:125` and `:226`,
 * `CustomFieldRenderer.tsx:367`, and the assignee select on the tickets list.
 * Those are deliberately NOT changed here; this card is the team page only.
 */
export type FilterablePerson = {
  displayName?: string | null;
  email?: string | null;
};

export function filterPeople<T extends FilterablePerson>(
  people: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [...people];
  }
  return people.filter((person) => {
    const name = (person.displayName ?? "").toLowerCase();
    const email = (person.email ?? "").toLowerCase();
    return name.includes(needle) || email.includes(needle);
  });
}
