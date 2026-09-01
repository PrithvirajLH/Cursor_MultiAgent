import { useEffect, useState } from "react";

/**
 * Whether this tab is currently the visible one.
 *
 * Extracted from `useNotifications` so the ticket list can gate its poll on the
 * same signal rather than registering a second `visibilitychange` listener.
 * Defaults to visible when there is no `document` (Node, tests).
 */
export function useTabVisible(): boolean {
  const [isTabVisible, setIsTabVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () =>
      setIsTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);
  return isTabVisible;
}
