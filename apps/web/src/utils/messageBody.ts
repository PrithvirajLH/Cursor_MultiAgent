import DOMPurify from "dompurify";
import { marked } from "marked";

const MENTION_REGEX = /@\[([^\]]+)\]\(user:([a-f0-9-]{36})\)/gi;

/** Match WYSIWYG mention span so we can convert to markdown token (attribute order may vary; display name may contain HTML entities). */
const MENTION_SPAN_REGEX =
  /<span\s[^>]*data-user-id="([a-f0-9-]{36})"[^>]*>@([^<]*)<\/span>/gi;

// Prevent tabnabbing: force rel="noopener noreferrer" on links with target="_blank"
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "a",
  "blockquote",
  "span",
];
const ALLOWED_ATTR = ["href", "target", "rel", "class"];

/** Valid opening tag pattern: <tagname followed by space, >, or /> (avoids treating "<3" or "<not html>" as HTML). */
const VALID_TAG_START = new RegExp(
  `^<(${ALLOWED_TAGS.join("|")})(\\s|>|/)`,
  "i",
);

/** Body is HTML from WYSIWYG only if it starts with a known tag (so plain text like "<3" stays markdown). */
function looksLikeHtml(body: string): boolean {
  const trimmed = body.trim();
  return VALID_TAG_START.test(trimmed);
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, "\u00A0");
}

/**
 * Convert WYSIWYG mention spans to canonical markdown tokens so mentions survive paste/cleanup that strips data-user-id.
 * Backend parses (user:uuid); display path replaces @[Name](user:id) with spans.
 */
export function htmlMentionsToMarkdown(body: string): string {
  if (!body || typeof body !== "string") return body;
  return body.replace(MENTION_SPAN_REGEX, (_, id, rawName) => {
    const name = decodeHtmlEntities((rawName || "").trim()) || "user";
    const safeName = name.replace(/\]/g, " "); // keep token parseable; ] would break @[name](user:id)
    return `@[${safeName}](user:${id})`;
  });
}

/** Block-level tags: nesting these inside <p> is invalid, so we only convert divs that don't contain them. */
const BLOCK_TAGS = new Set([
  "div",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function divHasBlockDescendant(div: Element): boolean {
  for (const el of div.querySelectorAll("*")) {
    if (BLOCK_TAGS.has(el.tagName.toLowerCase())) return true;
  }
  return false;
}

/**
 * Convert only "simple" contentEditable <div> wrappers (inline text, etc.) to <p> so they are not stripped.
 * Divs that contain block elements (lists, blockquote, etc.) are left as-is to avoid invalid nesting like <p><ul>...</ul></p>.
 * Uses DOM parsing when available (only divs with no block-level descendants → p); falls back to regex in non-DOM environments.
 */
export function normalizeDivToP(html: string): string {
  if (!html || typeof html !== "string") return "";
  if (typeof document === "undefined") {
    return html
      .replace(/<\/div>/gi, "</p>")
      .replace(/<div(\s[^>]*)?>/gi, "<p$1>");
  }
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const divs = [...wrap.querySelectorAll("div")];
  divs.sort(
    (a, b) =>
      a.querySelectorAll("div").length - b.querySelectorAll("div").length,
  );
  for (const div of divs) {
    if (divHasBlockDescendant(div)) continue;
    const p = document.createElement("p");
    for (const attr of div.attributes) p.setAttribute(attr.name, attr.value);
    while (div.firstChild) p.appendChild(div.firstChild);
    div.parentNode?.replaceChild(p, div);
  }
  return wrap.innerHTML;
}

/**
 * Sanitize HTML for display (e.g. from WYSIWYG). Does not allow data-user-id so mention id is not in DOM.
 */
export function sanitizeHtmlForDisplay(html: string): string {
  if (!html || typeof html !== "string") return "";
  return DOMPurify.sanitize(normalizeDivToP(html), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ["target"],
  });
}

/**
 * Replace @[DisplayName](user:userId) with a span for display, then parse markdown and sanitize.
 * If body looks like HTML (from WYSIWYG), sanitize only.
 */
export function messageBodyToHtml(body: string): string {
  if (!body || typeof body !== "string") return "";

  if (looksLikeHtml(body)) {
    const withMentionSpans = body.replace(MENTION_REGEX, (_, name) => {
      return `<span class="mention">@${escapeHtml(name)}</span>`;
    });
    return sanitizeHtmlForDisplay(withMentionSpans);
  }

  const withMentions = body.replace(MENTION_REGEX, (_, name) => {
    return `<span class="mention">@${escapeHtml(name)}</span>`;
  });

  const rawHtml = marked.parse(withMentions, {
    gfm: true,
    breaks: true,
  }) as string;

  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ["target"],
  });
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
