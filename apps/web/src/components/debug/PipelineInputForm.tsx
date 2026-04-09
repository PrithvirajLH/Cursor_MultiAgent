import { useState } from "react";
import { Play, Loader2 } from "lucide-react";

interface PipelineInputFormProps {
  onSubmit: (text: string, userId?: string) => void;
  isLoading: boolean;
}

export function PipelineInputForm({
  onSubmit,
  isLoading,
}: PipelineInputFormProps) {
  const [text, setText] = useState(
    "I can't access SAP and I have a deadline tomorrow for the quarterly report",
  );
  const [userId, setUserId] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || isLoading) return;
    onSubmit(text.trim(), userId.trim() || undefined);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1.5">
          Request Text
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          disabled={isLoading}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none"
          placeholder="Describe the problem..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">
          User ID{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          disabled={isLoading}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 font-mono"
          placeholder="UUID of the requester"
        />
      </div>

      <button
        type="submit"
        disabled={!text.trim() || isLoading}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Running Pipeline...
          </>
        ) : (
          <>
            <Play className="h-4 w-4" />
            Run Pipeline
          </>
        )}
      </button>
    </form>
  );
}
