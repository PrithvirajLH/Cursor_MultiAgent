import { useQuery } from "@tanstack/react-query";
import {
  fetchReportSummary,
  fetchTicketCounts,
  fetchTicketMetrics,
  type ReportQuery,
} from "../api/client";
import type { Role } from "../types";
import { countBoundaries } from "../components/shell/count-boundaries";

/**
 * The single source of every fixed ticket count in the shell.
 *
 * ⚠️ CARD 1.69 STEP 4 MADE THIS THE ONLY ONE. The sidebar used to fill nine
 * badges with nine uncached `GET /tickets?pageSize=1` calls while this hook
 * answered ten other questions in one cached call - two count systems that
 * cards 1.16, 1.53 and 1.65 each ran into separately, and that 1.65 hit as a
 * nav badge stuck on a stale number because it came from the other source.
 * The sidebar now calls THIS hook, and React Query dedupes it against App's
 * call to the same key, so the pair is one request rather than ten.
 *
 * ⚠️ THE BOUNDARIES ARE IN THE KEY, not just the request. Three badges are
 * defined against the user's local midnight; if the key ignored the dates, a
 * tab left open past midnight would keep serving yesterday's "today" out of
 * cache. A changed date is a new key and refetches by itself.
 */
export function useTicketCountsQuery(currentEmail: string) {
  const boundaries = countBoundaries();
  return useQuery({
    // Include currentEmail in the key so each persona gets an isolated cache.
    queryKey: ["ticketCounts", currentEmail, boundaries],
    queryFn: () => fetchTicketCounts(boundaries),
    // Ticket count aggregates are cheap to refetch and should feel fresh.
    staleTime: 5_000,
  });
}

type DashboardMetricsKey = {
  role: Role;
  range: "3" | "7" | "30";
  sort: "recent" | "oldest";
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
    queryKey: ["dashboardMetrics", role, range, sort],
    queryFn: () => fetchTicketMetrics(),
  });
}

type ManagerMetricsKey = {
  dateRange: number;
  userScopeKey: string;
};

export function useManagerMetricsQuery(params: ManagerMetricsKey) {
  const { dateRange, userScopeKey } = params;
  return useQuery({
    queryKey: ["managerMetrics", dateRange, userScopeKey],
    queryFn: () => fetchTicketMetrics(),
  });
}

export function useReportsQuery(reportQuery: ReportQuery) {
  return useQuery({
    queryKey: ["reports", reportQuery],
    queryFn: () => fetchReportSummary(reportQuery),
    // Reports can be moderately heavy; treat them as more static.
    staleTime: 60_000,
  });
}
