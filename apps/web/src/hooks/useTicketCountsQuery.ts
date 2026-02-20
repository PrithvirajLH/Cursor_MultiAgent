import { useQuery } from '@tanstack/react-query';
import {
  fetchReportSummary,
  fetchTicketCounts,
  fetchTicketMetrics,
  type ReportQuery
} from '../api/client';
import type { Role } from '../types';

export function useTicketCountsQuery(currentEmail: string) {
  return useQuery({
    // Include currentEmail in the key so each persona gets an isolated cache.
    queryKey: ['ticketCounts', currentEmail],
    queryFn: () => fetchTicketCounts(),
    // Ticket count aggregates are cheap to refetch and should feel fresh.
    staleTime: 5_000
  });
}

type DashboardMetricsKey = {
  role: Role;
  range: '3' | '7' | '30';
  sort: 'recent' | 'oldest';
};

/**
 * Lightweight dashboard metrics query.
 *
 * This intentionally wraps a narrow slice of the full DashboardPage data and is
 * designed so we can incrementally migrate the dashboard to React Query.
 */
export function useDashboardMetricsQuery(params: DashboardMetricsKey) {
  const { role, range, sort } = params;
  return useQuery({
    queryKey: ['dashboardMetrics', role, range, sort],
    queryFn: () => fetchTicketMetrics()
  });
}

type ManagerMetricsKey = {
  dateRange: number;
  userScopeKey: string;
};

export function useManagerMetricsQuery(params: ManagerMetricsKey) {
  const { dateRange, userScopeKey } = params;
  return useQuery({
    queryKey: ['managerMetrics', dateRange, userScopeKey],
    queryFn: () => fetchTicketMetrics()
  });
}

export function useReportsQuery(reportQuery: ReportQuery) {
  return useQuery({
    queryKey: ['reports', reportQuery],
    queryFn: () => fetchReportSummary({ ...reportQuery, groupBy: 'team' }),
    // Reports can be moderately heavy; treat them as more static.
    staleTime: 60_000
  });
}


