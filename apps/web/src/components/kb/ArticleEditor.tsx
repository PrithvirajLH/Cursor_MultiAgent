import { useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

/**
 * Notion-style block editor (BlockNote) for knowledge-base articles.
 * Keeps a simple value/onChange (HTML string) interface so callers are unchanged:
 * incoming HTML is parsed into blocks, and edits are emitted back as HTML.
 */
export function ArticleEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const editor = useCreateBlockNote();
  const lastEmitted = useRef<string>("");
  const initialized = useRef(false);

  // Follow the app's light/dark theme (class on <html>).
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark")),
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  // Load externally-provided HTML (e.g. when editing an existing article) into
  // the editor once, without clobbering the user's in-progress edits.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    if (!value) return;
    let cancelled = false;
    void (async () => {
      const blocks = await editor.tryParseHTMLToBlocks(value);
      if (cancelled) return;
      editor.replaceBlocks(editor.document, blocks);
      lastEmitted.current = value;
      initialized.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, value]);

  async function handleChange() {
    const html = await editor.blocksToHTMLLossy(editor.document);
    lastEmitted.current = html;
    onChange(html);
  }

  return (
    <div className="kb-blocknote overflow-hidden rounded-xl border border-border bg-card">
      <BlockNoteView
        editor={editor}
        theme={dark ? "dark" : "light"}
        onChange={() => void handleChange()}
        className="min-h-[calc(100vh-360px)] py-3"
      />
    </div>
  );
}
