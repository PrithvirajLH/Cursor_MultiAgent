import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TagFilterInput } from "./TagFilterInput";
import { parseTagList } from "../utils/parseTagList";

/**
 * Card 1.56 — the macro editor's tag field ate commas, exactly as the tickets
 * filter did before card 1.50.
 *
 * The old control was a text input with `value={(action.tags ?? []).join(", ")}`
 * and an `onChange` that split on comma and dropped empty segments, so the
 * segment created the instant you press `,` vanished and React wrote the comma
 * back out. Its placeholder was `"password, vpn"` — a two-tag example the
 * control made impossible to type.
 */
describe("macro editor tag field (card 1.56)", () => {
  it("⚠️ holds two tags as two separate chips, with the macro editor's label", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. The old field could not
    // represent two tags at all: "password, vpn" became the single tag
    // "passwordvpn", which matches nothing and reports no error.
    const html = renderToStaticMarkup(
      <TagFilterInput
        tags={["password", "vpn"]}
        onChange={() => {}}
        label="Tags"
        placeholder="password, vpn"
      />,
    );
    expect(html).toContain('aria-label="Remove tag password"');
    expect(html).toContain('aria-label="Remove tag vpn"');
    expect(html).not.toContain("passwordvpn");
    expect(html).toContain('aria-label="Tags"');
  });

  it("⚠️ the placeholder it advertises is now actually typeable", () => {
    // The example in the placeholder was a promise the control could not keep.
    const html = renderToStaticMarkup(
      <TagFilterInput
        tags={[]}
        onChange={() => {}}
        label="Tags"
        placeholder="password, vpn"
      />,
    );
    expect(html).toContain('placeholder="password, vpn"');
    expect(parseTagList("password, vpn")).toEqual(["password", "vpn"]);
  });

  it("commits both tags through the same parser the tickets filter uses", () => {
    // One parser for tag lists, so a tag typed in a macro and a tag typed in
    // the tickets filter can never be normalised differently.
    const onChange = vi.fn();
    const commit = (raw: string) => onChange(parseTagList(raw));
    commit("password, vpn");
    expect(onChange).toHaveBeenCalledWith(["password", "vpn"]);
  });

  it("leaves the tickets filter's own defaults untouched", () => {
    // The label and placeholder props were added for this second caller; the
    // original call site passes neither and must render as it always did.
    const html = renderToStaticMarkup(
      <TagFilterInput tags={[]} onChange={() => {}} />,
    );
    expect(html).toContain('aria-label="Filter by tag"');
    expect(html).toContain('placeholder="Filter by tag"');
  });
});
