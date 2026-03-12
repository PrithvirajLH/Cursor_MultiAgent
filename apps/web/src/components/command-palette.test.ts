import { describe, expect, it } from "vitest";
import { getNextCommandPaletteSelectedIndex } from "./CommandPalette";

describe("command palette keyboard selection", () => {
  it("keeps the selection clamped at zero when there are no results", () => {
    expect(getNextCommandPaletteSelectedIndex(0, "ArrowDown", 0)).toBe(0);
    expect(getNextCommandPaletteSelectedIndex(3, "ArrowDown", 0)).toBe(0);
    expect(getNextCommandPaletteSelectedIndex(0, "ArrowUp", 0)).toBe(0);
  });

  it("clamps navigation within the available result range", () => {
    expect(getNextCommandPaletteSelectedIndex(0, "ArrowDown", 3)).toBe(1);
    expect(getNextCommandPaletteSelectedIndex(2, "ArrowDown", 3)).toBe(2);
    expect(getNextCommandPaletteSelectedIndex(1, "ArrowUp", 3)).toBe(0);
    expect(getNextCommandPaletteSelectedIndex(0, "ArrowUp", 3)).toBe(0);
  });
});
