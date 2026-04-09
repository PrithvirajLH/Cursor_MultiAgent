import { Lightbulb } from "lucide-react";

interface ExamplePromptsProps {
  onSelect: (text: string) => void;
}

const EXAMPLES = [
  "I can't access my email and I have a deadline tomorrow",
  "How do I request PTO for next week?",
  "My laptop screen is flickering — need a replacement",
  "I need access to the finance dashboard for quarterly reporting",
];

export function ExamplePrompts({ onSelect }: ExamplePromptsProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lightbulb className="h-3.5 w-3.5" />
        <span>Try an example</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {EXAMPLES.map((text) => (
          <button
            key={text}
            onClick={() => onSelect(text)}
            className="text-left text-sm px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/30 transition-colors line-clamp-2"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
