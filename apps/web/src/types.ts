export type Role = 'EMPLOYEE' | 'AGENT' | 'LEAD' | 'ADMIN' | 'TEAM_ADMIN' | 'OWNER';

export type StatusFilter = 'open' | 'resolved' | 'all';
export type SortField = 'createdAt' | 'completedAt' | 'updatedAt';
export type SortOrder = 'asc' | 'desc';
export type SlaStatusFilter = 'on_track' | 'at_risk' | 'breached';

export type TicketFilters = {
  statusGroup?: StatusFilter;
  statuses: string[];
  priorities: string[];
  teamIds: string[];
  assigneeIds: string[];
  requesterIds: string[];
  slaStatus: SlaStatusFilter[];
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
  dueFrom: string;
  dueTo: string;
  q: string;
  scope: TicketScope;
  sort: SortField;
  order: SortOrder;
  page: number;
  pageSize: number;
};
export type TicketScope = 'all' | 'assigned' | 'unassigned' | 'created';

export type DashboardStats = {
  open: number;
  resolved: number;
  total: number;
  unassigned?: number;
  assignedToMe?: number;
  resolvedByMe?: number;
};
