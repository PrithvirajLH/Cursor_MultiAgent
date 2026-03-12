import React, { createContext, useContext, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

type TicketDataInvalidationContextValue = {
  notifyTicketAggregatesChanged: () => void;
  notifyTicketReportsChanged: () => void;
};

const TicketDataInvalidationContext = createContext<
  TicketDataInvalidationContextValue | undefined
>(undefined);

export function TicketDataInvalidationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();

  const value = useMemo<TicketDataInvalidationContextValue>(
    () => ({
      notifyTicketAggregatesChanged: () => {
        // Invalidate lightweight aggregate queries so shared consumers (e.g. sidebar)
        // get fresh values without forcing full dashboard/manager refresh patterns.
        void queryClient.invalidateQueries({ queryKey: ["ticketCounts"] });
      },
      notifyTicketReportsChanged: () => {
        // Keep a separate namespace for heavier report queries so we can treat them
        // differently if needed (e.g. debounce or manual refresh).
        void queryClient.invalidateQueries({ queryKey: ["reports"] });
      },
    }),
    [queryClient],
  );

  return (
    <TicketDataInvalidationContext.Provider value={value}>
      {children}
    </TicketDataInvalidationContext.Provider>
  );
}

export function useTicketDataInvalidation(): TicketDataInvalidationContextValue {
  const ctx = useContext(TicketDataInvalidationContext);
  if (!ctx) {
    throw new Error(
      "useTicketDataInvalidation must be used within a TicketDataInvalidationProvider",
    );
  }
  return ctx;
}
