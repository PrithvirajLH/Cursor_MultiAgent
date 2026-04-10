import { useMemo } from "react";
import { messageBodyToHtml } from "../utils/messageBody";

export function MessageBody({
  body,
  className = "",
  invert = false,
}: {
  body: string;
  className?: string;
  /** When true, use light text for dark backgrounds (e.g. own message bubble). */
  invert?: boolean;
}) {
  const html = useMemo(() => messageBodyToHtml(body ?? ""), [body]);

  if (!html) {
    return (
      <p
        className={`text-sm ${invert ? "text-foreground" : "text-muted-foreground"} ${className}`}
      >
        —
      </p>
    );
  }

  const baseClasses =
    "message-body text-sm max-w-none whitespace-pre-wrap break-words prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0";
  const colorClasses = invert
    ? "text-white prose-invert prose-a:text-sky-200 [&_.mention]:text-white [&_.mention]:bg-transparent"
    : "text-foreground prose prose-invert";

  return (
    <div
      className={`${baseClasses} ${colorClasses} ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
