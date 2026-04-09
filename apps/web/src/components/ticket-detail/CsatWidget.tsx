import { useState, useEffect } from "react";
import { Star, Send, CheckCircle2 } from "lucide-react";
import { submitCsat, fetchCsat } from "../../api/client";

interface CsatWidgetProps {
  ticketId: string;
  ticketStatus: string;
  isRequester: boolean;
}

export function CsatWidget({
  ticketId,
  ticketStatus,
  isRequester,
}: CsatWidgetProps) {
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [existingRating, setExistingRating] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Only show for resolved/closed tickets to requesters
  const isVisible =
    isRequester && ["RESOLVED", "CLOSED"].includes(ticketStatus);

  useEffect(() => {
    if (!isVisible) {
      setLoading(false);
      return;
    }

    fetchCsat(ticketId)
      .then((res) => {
        if (res.data?.payload) {
          const payload = res.data.payload as { rating: number };
          setExistingRating(payload.rating);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticketId, isVisible]);

  if (!isVisible || loading) return null;

  async function handleSubmit() {
    if (rating === 0 || isSubmitting) return;
    setIsSubmitting(true);

    try {
      await submitCsat({
        ticketId,
        rating,
        comment: comment.trim() || undefined,
      });
      setSubmitted(true);
      setExistingRating(rating);
    } catch {
      // Silently fail — non-critical
    } finally {
      setIsSubmitting(false);
    }
  }

  // Already rated
  if (existingRating !== null && !submitted) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-muted-foreground">Your rating:</span>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`h-4 w-4 ${
                  star <= existingRating
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-muted-foreground/30"
                }`}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {existingRating}/5
          </span>
        </div>
      </div>
    );
  }

  // Just submitted
  if (submitted) {
    return (
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 text-center">
        <CheckCircle2 className="h-6 w-6 text-green-500 mx-auto mb-1" />
        <p className="text-sm font-medium">Thank you for your feedback!</p>
      </div>
    );
  }

  // Rating form
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-sm font-medium">How was your experience?</p>

      {/* Stars */}
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => setRating(star)}
            onMouseEnter={() => setHoveredStar(star)}
            onMouseLeave={() => setHoveredStar(0)}
            className="p-1 rounded hover:bg-accent transition-colors"
          >
            <Star
              className={`h-6 w-6 transition-colors ${
                star <= (hoveredStar || rating)
                  ? "fill-yellow-400 text-yellow-400"
                  : "text-muted-foreground/30"
              }`}
            />
          </button>
        ))}
      </div>

      {/* Comment */}
      {rating > 0 && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Any additional feedback? (optional)"
            rows={2}
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
          />
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Submit Rating
          </button>
        </>
      )}
    </div>
  );
}
