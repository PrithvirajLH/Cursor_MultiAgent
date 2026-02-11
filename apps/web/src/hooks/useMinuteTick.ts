import { useEffect, useState } from 'react';

type Listener = () => void;

// Shared minute ticker to avoid creating one interval per RelativeTime instance.
const listeners = new Set<Listener>();
let timer: number | null = null;

function ensureTimer() {
  if (timer != null) return;
  timer = window.setInterval(() => {
    for (const listener of listeners) listener();
  }, 60_000);
}

function maybeStopTimer() {
  if (listeners.size !== 0) return;
  if (timer == null) return;
  window.clearInterval(timer);
  timer = null;
}

export function useMinuteTick(enabled: boolean) {
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    ensureTimer();

    return () => {
      listeners.delete(listener);
      maybeStopTimer();
    };
  }, [enabled]);
}

