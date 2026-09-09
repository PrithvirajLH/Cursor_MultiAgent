import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { parseTagList } from "../utils/parseTagList";

/**
 * The tag filter on the tickets list (card 1.50).
 *
 * ⚠️ WHAT THIS REPLACES, AND WHY A CHIP CONTROL RATHER THAN A BETTER TEXT BOX.
 *
 * It used to be a controlled text input labelled "Tags (csv)" whose `onChange`
 * split on commas and whose `value` re-joined the result. The empty segment
 * created the instant you press `,` was dropped, so React wrote the comma back
 * out of the box:
 *
 *     key ","  ->  box shows "network"      <- comma gone
 *     key "p"  ->  box shows "networkp"     <- the two tags fuse
 *     result:      ["networkprinter"]       <- matches nothing, no error
 *
 * So single-tag filtering worked and multi-tag was unreachable from the UI,
 * with no error to explain it. The capability was never missing —
 * `list-tickets.dto.ts` has accepted `tags?: string[]` all along and
 * `?tags=network,printer` in the URL has always worked.
 *
 * A chip control is the better answer because the state it shows is the state
 * it holds: each tag is a discrete thing you can see and remove, and there is
 * no round trip through a string for a keystroke to fall into. A smarter text
 * box would still ask a nurse to know that commas separate tags, which is the
 * assumption the label "csv" was making out loud.
 *
 * Enter or comma commits what is typed; Backspace on an empty box removes the
 * last chip, which is what every chip control does.
 */
export function TagFilterInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    // Through the SAME parser the URL uses, so a tag typed here and a tag
    // arriving in `?tags=` can never be normalised differently.
    const parsed = parseTagList(raw);
    if (parsed.length === 0) {
      return;
    }
    const next = [...tags];
    for (const tag of parsed) {
      if (!next.includes(tag)) {
        next.push(tag);
      }
    }
    setDraft("");
    onChange(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      // A comma is a commit, not a character. Without this it would land in
      // the draft and the old fusing behaviour would be one refactor away.
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="flex h-10 w-56 items-center gap-1 overflow-x-auto rounded-xl border border-border bg-card px-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/30 transition-all">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => onChange(tags.filter((value) => value !== tag))}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        // Plain language, no "csv": the owner's standing preference, and the
        // control no longer needs the reader to know the trick.
        aria-label="Filter by tag"
        placeholder={tags.length === 0 ? "Filter by tag" : ""}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        className="min-w-16 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
