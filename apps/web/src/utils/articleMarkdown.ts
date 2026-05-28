import DOMPurify from "dompurify";
import { marked } from "marked";

// Force rel="noopener noreferrer" on target=_blank links (tabnabbing guard).
// DOMPurify hooks are global; adding the same hook twice is harmless.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// Article-grade allowlist: richer than chat messages (headings, tables, hr).
const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "span",
  "div",
  "img",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];
const ALLOWED_ATTR = [
  "href",
  "target",
  "rel",
  "class",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "align",
];

const SANITIZE_OPTS = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ADD_ATTR: ["target"],
};

/** True when the content is already HTML (from the WYSIWYG editor). */
function looksLikeHtml(content: string): boolean {
  return /^\s*<(p|div|h[1-6]|ul|ol|blockquote|pre|table|br|strong|em|span|img)[\s>/]/i.test(
    content.trim(),
  );
}

/** Sanitize WYSIWYG editor HTML for storage/display. */
export function sanitizeArticleHtml(html: string): string {
  if (!html || typeof html !== "string") return "";
  return DOMPurify.sanitize(html, SANITIZE_OPTS);
}

/**
 * Render article content to sanitized HTML for display.
 * Accepts WYSIWYG HTML (sanitized as-is) or legacy Markdown (parsed first).
 */
export function renderArticleContent(content: string): string {
  if (!content || typeof content !== "string") return "";
  if (looksLikeHtml(content)) {
    return DOMPurify.sanitize(content, SANITIZE_OPTS);
  }
  const rawHtml = marked.parse(content, { gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(rawHtml, SANITIZE_OPTS);
}

/** @deprecated use renderArticleContent — kept for compatibility. */
export const renderArticleMarkdown = renderArticleContent;
