import { describe, expect, it } from "vitest";
import { parseTagList } from "./parseTagList";

/**
 * Card 1.50 — typing two tags must yield two tags.
 *
 * Nothing tested this. The tickets list had its own inline copy of this parser
 * that ate every comma, so multi-tag filtering was unreachable from the UI
 * while `?tags=network,printer` in the URL worked fine.
 */
describe("parseTagList", () => {
  it("⚠️ turns two comma-separated tags into TWO tags", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. The old control produced
    // ["networkprinter"] from this exact input - one fused tag that matches
    // nothing, with no error to explain it.
    expect(parseTagList("network, printer")).toEqual(["network", "printer"]);
  });

  it("lowercases, because the server normalises tag names that way", () => {
    expect(parseTagList("VPN, Printer")).toEqual(["vpn", "printer"]);
  });

  it("drops empty segments rather than producing blank tags", () => {
    // Which is correct here - it is only wrong when it feeds back into an
    // input's value, which is what the deleted copy did.
    expect(parseTagList("network,,printer,")).toEqual(["network", "printer"]);
    expect(parseTagList(",")).toEqual([]);
  });

  it("de-duplicates, including across case", () => {
    expect(parseTagList("vpn, VPN, vpn")).toEqual(["vpn"]);
  });

  it("handles a single tag, which always worked", () => {
    expect(parseTagList("network")).toEqual(["network"]);
  });

  it("is empty for nothing", () => {
    expect(parseTagList("")).toEqual([]);
    expect(parseTagList(null)).toEqual([]);
    expect(parseTagList(undefined)).toEqual([]);
    expect(parseTagList("   ")).toEqual([]);
  });
});
