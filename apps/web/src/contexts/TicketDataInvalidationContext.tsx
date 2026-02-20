import React, { createContext, useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type TicketDataInvalidationContextValue = {
  refreshKey: number;
  notifyTicketAggregatesChanged: () => void;
  notifyTicketReportsChanged: () => void;
};

const TicketDataInvalidationContext = createContext<TicketDataInvalidationContextValue | undefined>(
  undefined
);

export function TicketDataInvalidationProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [refreshKey, setRefreshKey] = useState(0);

  const value = useMemo<TicketDataInvalidationContextValue>(
    () => ({
      refreshKey,
      notifyTicketAggregatesChanged: () => {
        // Bump refreshKey so views that depend on it (dashboard, manager, triage, tickets)
        // refetch their data.
        setRefreshKey((prev) => prev + 1);

        // Invalidate lightweight aggregate queries so shared consumers (e.g. sidebar)
        // get fresh values without relying on manual effects.
        void queryClient.invalidateQueries({ queryKey: ['ticketCounts'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboardMetrics'] });
        void queryClient.invalidateQueries({ queryKey: ['managerMetrics'] });
      },
      notifyTicketReportsChanged: () => {
        // Keep a separate namespace for heavier report queries so we can treat them
        // differently if needed (e.g. debounce or manual refresh).
        void queryClient.invalidateQueries({ queryKey: ['reports'] });
      }
    }),
    [queryClient, refreshKey]
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
      'useTicketDataInvalidation must be used within a TicketDataInvalidationProvider'
    );
  }
  return ctx;
}

