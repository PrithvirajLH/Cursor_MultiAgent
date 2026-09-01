import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkifiedText } from "./LinkifiedText";

/** The real shape of a Power Automate PAF description, minus the other rows. */
const SHAREPOINT_URL =
  "https://creativesnhc.sharepoint.com/:b:/s/HRAutomations/IQC8EBCkHq9HSqB5cEiUXOYMAaGSqGPCdsxDDoRn3nLiT04";

describe("LinkifiedText", () => {
  it("turns a URL into a link that opens safely in a new tab", () => {
    const html = renderToStaticMarkup(
      <LinkifiedText text={`Link to Files: ${SHAREPOINT_URL}`} />,
    );
    expect(html).toContain(`href="${SHAREPOINT_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("keeps the surrounding words, in place", () => {
    const html = renderToStaticMarkup(
      <LinkifiedText text={`before ${SHAREPOINT_URL} after`} />,
    );
    expect(html).toMatch(/^before <a [^>]*>/);
    expect(html).toMatch(/<\/a> after$/);
  });

  it("does not swallow an HTML fragment that follows the URL", () => {
    const html = renderToStaticMarkup(
      <LinkifiedText text={`${SHAREPOINT_URL}<br>`} />,
    );
    expect(html).toContain(`href="${SHAREPOINT_URL}"`);
    expect(html).not.toContain("br&gt;\"");
    expect(html).toContain("&lt;br&gt;");
  });

  it("leaves sentence punctuation out of the link", () => {
    const html = renderToStaticMarkup(
      <LinkifiedText text="Open https://example.com/a-file.pdf, then sign it." />,
    );
    expect(html).toContain('href="https://example.com/a-file.pdf"');
    expect(html).toContain("</a>, then sign it.");
  });

  it("links every URL in a description, not just the first", () => {
    const html = renderToStaticMarkup(
      <LinkifiedText text={`One https://a.example.com/x\nTwo https://b.example.com/y`} />,
    );
    expect(html).toContain('href="https://a.example.com/x"');
    expect(html).toContain('href="https://b.example.com/y"');
  });

  it("refuses to link anything that is not http(s)", () => {
    const html = renderToStaticMarkup(
      <LinkifiedText text="javascript:alert(1) and data:text/html;base64,x and file:///c:/secrets" />,
    );
    expect(html).not.toContain("<a ");
  });

  it("renders text with no URL unchanged and without a wrapper", () => {
    const html = renderToStaticMarkup(
      <LinkifiedText text="Employee Number: 106783" />,
    );
    expect(html).toBe("Employee Number: 106783");
  });

  it("renders nothing for an empty description", () => {
    expect(renderToStaticMarkup(<LinkifiedText text="" />)).toBe("");
  });
});
