import { useSyncExternalStore } from "react";
import { sessionExpiryStore } from "../api/session-expiry-store";

/**
 * Whether the API is currently refusing this session (card 1.54).
 *
 * A screen that reads this must show a session-expired surface rather than a
 * data-loading error: *"Unable to load tickets"* with a **Retry** button is
 * wrong twice over, because retrying cannot mint a token and the wording blames
 * the data rather than the credential.
 */
export function useSessionExpired(): boolean {
  return useSyncExternalStore(
    (listener) => sessionExpiryStore.subscribe(listener),
    () => sessionExpiryStore.isExpired(),
    () => false,
  );
}
