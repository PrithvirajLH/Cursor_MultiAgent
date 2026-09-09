import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Card 1.58 — the modal focus trap stole the caret on every render.
 *
 * ⚠️ WHY THIS TEST READS THE SOURCE INSTEAD OF RENDERING.
 *
 * The bug is a React *effect-dependency* property: an unstable `onClose`
 * identity made the effect tear down and re-run on every render, and its
 * cleanup calls `previouslyFocused?.focus()`. Proving that behaviourally needs
 * a DOM, a renderer and a re-render — and this project has **no jsdom, no
 * happy-dom and no testing-library** (checked: none are resolvable). Card 1.49
 * met the same wall by extracting the logic into a pure function, but here
 * there is no logic to extract: the defect lives entirely in the dependency
 * array.
 *
 * So this asserts the mechanism structurally. That is unusual, and it is worth
 * being clear about what it does and does not buy:
 *
 *  - It **is** a real regression assertion. Putting `onClose` back into the
 *    deps, or calling it directly instead of through the ref, fails it. It
 *    cannot pass with the bug present, which is the bar this repo has had
 *    trouble with.
 *  - It is **not** proof that focus behaves. That is what the browser pass is
 *    for, and typing into the macro dialog's tag field is the check that was
 *    impossible before this card.
 */
describe("useModalFocusTrap dependencies (card 1.58)", () => {
  /** The hook's source with comments removed, so prose cannot satisfy a match. */
  const source = (() => {
    const raw = readFileSync(
      join(__dirname, "useModalFocusTrap.ts"),
      "utf8",
    );
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  })();

  it("⚠️ does NOT list onClose in the effect dependency array", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. `onClose` in the deps plus
    // an inline arrow at any of the fifteen call sites means the effect re-runs
    // every render, and its cleanup yanks focus back to the opener mid-keystroke.
    const depArrays = [...source.matchAll(/\}\s*,\s*\[([^\]]*)\]\s*\)/g)].map(
      (match) => match[1].replace(/\s+/g, ""),
    );
    expect(depArrays.length).toBeGreaterThan(0);
    for (const deps of depArrays) {
      expect(deps.split(",").filter(Boolean)).not.toContain("onClose");
    }
  });

  it("⚠️ reaches the handler through a ref, so its identity cannot matter", () => {
    // The other half: absent from the deps but still called directly would be a
    // stale-closure bug instead of a focus bug.
    expect(source).toContain("onCloseRef");
    expect(source).toMatch(/onCloseRef\.current\?\.\(\)/);
    expect(source).not.toMatch(/[^.]\bonClose\?\.\(\)/);
  });

  it("keeps the effect keyed on open and the container", () => {
    // Narrowing the deps must not go so far that the trap stops re-arming when
    // the modal opens.
    expect(source).toMatch(/\[\s*open\s*,\s*containerRef\s*\]/);
  });

  it("⚠️ still restores focus to whatever opened the modal", () => {
    // Deleting the restore would also "fix" the bug, and would break the
    // accessible behaviour card 3.8 wants. The fix was WHEN it runs, not that.
    expect(source).toContain("previouslyFocused");
    expect(source).toMatch(/previouslyFocused\?\.focus\(\)/);
  });

  it("still closes on Escape and still traps Tab", () => {
    expect(source).toContain('"Escape"');
    expect(source).toContain('"Tab"');
  });
});
