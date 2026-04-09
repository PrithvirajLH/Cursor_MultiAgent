import { useRef, useState, useEffect } from "react";
import { Send, Paperclip, Loader2 } from "lucide-react";

interface ChatInputProps {
  onSubmit: (text: string) => void;
  isLoading: boolean;
  placeholder?: string;
  defaultValue?: string;
}

export function ChatInput({
  onSubmit,
  isLoading,
  placeholder = "Describe what you need help with...",
  defaultValue,
}: ChatInputProps) {
  const [text, setText] = useState(defaultValue ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (defaultValue) setText(defaultValue);
  }, [defaultValue]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    onSubmit(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="relative rounded-xl border border-border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-primary/40 transition-all">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isLoading}
        rows={4}
        className="w-full resize-none border-0 bg-transparent text-sm leading-relaxed focus:outline-none pr-24 p-4 placeholder:text-muted-foreground"
      />
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
        <button
          type="button"
          className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          disabled={isLoading}
          title="Attach file (coming soon)"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="h-9 w-9 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleSubmit}
          disabled={!text.trim() || isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
