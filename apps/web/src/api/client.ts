const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';
const DEFAULT_EMAIL = import.meta.env.VITE_DEMO_USER_EMAIL as string | undefined;
let authToken: string | null = null;

/** Thrown by apiFetch when response is not ok; includes status for UI (e.g. 403). */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type UserRef = {
  id: string;
  email: string;
  displayName: string;
  role?: string;
};

export type MicrosoftGraphProfile = {
  id: string;
  displayName?: string | null;
  givenName?: string | null;
  surname?: string | null;
  userPrincipalName?: string | null;
  mail?: string | null;
  jobTitle?: string | null;
  mobilePhone?: string | null;
  businessPhones?: string[];
  officeLocation?: string | null;
  preferredLanguage?: string | null;
  department?: string | null;
  companyName?: string | null;
  employeeId?: string | null;
  employeeType?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  streetAddress?: string | null;
  usageLocation?: string | null;
  mailNickname?: string | null;
};

export type CurrentUserSession = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  teamId: string | null;
  teamRole: string | null;
  primaryTeamId: string | null;
  graphProfile?: MicrosoftGraphProfile | null;
  avatarDataUrl?: string | null;
};

export type TeamRef = {
  id: string;
  name: string;
  assignmentStrategy?: string;
};

export type CategoryRef = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  isActive: boolean;
  parentId?: string | null;
  parent?: CategoryRef | null;
};

export type RoutingRule = {
  id: string;
  name: string;
  keywords: string[];
  teamId: string;
  assigneeId?: string | null;
  priority: number;
  isActive: boolean;
  team?: TeamRef;
  assignee?: UserRef | null;
};

export type TicketRecord = {
  id: string;
  number: number;
  displayId?: string | null;
  subject: string;
  description?: string | null;
  status: string;
  priority: string;
  channel?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  closedAt?: string | null;
  completedAt?: string | null;
  requester?: UserRef | null;
  assignee?: UserRef | null;
  assignedTeam?: TeamRef | null;
  category?: CategoryRef | null;
  dueAt?: string | null;
  firstResponseDueAt?: string | null;
  firstResponseAt?: string | null;
  slaPausedAt?: string | null;
};

export type TicketMessage = {
  id: string;
  body: string;
  type: string;
  createdAt: string;
  author: UserRef;
};

export type TicketEvent = {
  id: string;
  type: string;
  createdAt: string;
  payload?: Record<string, unknown> | null;
  createdBy?: UserRef | null;
};

export type Attachment = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  scanStatus?: string;
  uploadedBy: UserRef;
};

export type TicketFollower = {
  id: string;
  createdAt: string;
  user: UserRef;
};

export type CustomFieldRecord = {
  id: string;
  name: string;
  fieldType: string;
  options?: unknown;
  isRequired: boolean;
  teamId: string | null;
  categoryId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CustomFieldValueRecord = {
  id: string;
  ticketId: string;
  customFieldId: string;
  value: string | null;
  createdAt: string;
  updatedAt: string;
  customField: CustomFieldRecord;
};

export type TicketDetail = TicketRecord & {
  followers: TicketFollower[];
  attachments: Attachment[];
  customFieldValues?: CustomFieldValueRecord[];
  allowedTransitions?: string[];
};

export type TicketMessagePage = {
  data: TicketMessage[];
  nextCursor?: string | null;
};

export type TicketEventPage = {
  data: TicketEvent[];
  nextCursor?: string | null;
};

export type TeamMember = {
  id: string;
  role: string;
  createdAt: string;
  user: UserRef;
  team: TeamRef;
};

export type SlaPolicy = {
  priority: string;
  firstResponseHours: number;
  resolutionHours: number;
  source?: 'team' | 'default';
};

export type SlaPolicyNotifyRole = 'AGENT' | 'LEAD' | 'MANAGER' | 'OWNER';

export type SlaPolicyConfigRecord = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  enabled: boolean;
  businessHoursOnly: boolean;
  escalationEnabled: boolean;
  escalationAfterPercent: number;
  breachNotifyRoles: SlaPolicyNotifyRole[];
  appliedTeamIds: string[];
  appliedTeams: Array<{ id: string; name: string }>;
  targets: Array<{
    priority: string;
    firstResponseHours: number;
    resolutionHours: number;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type SlaBusinessDayRecord = {
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  enabled: boolean;
  start: string;
  end: string;
};

export type SlaHolidayRecord = {
  name: string;
  date: string;
};

export type SlaBusinessHoursSettings = {
  timezone: string;
  schedule: SlaBusinessDayRecord[];
  holidays: SlaHolidayRecord[];
  createdAt: string;
  updatedAt: string;
};

export type TicketListResponse = {
  data: TicketRecord[];
  meta: PaginationMeta;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type TicketActivityPoint = {
  date: string;
  open: number;
  resolved: number;
};

export type TicketStatusPoint = {
  status: string;
  count: number;
};

export type CreateTicketPayload = {
  subject: string;
  description: string;
  priority?: string;
  channel?: string;
  assignedTeamId?: string;
  assigneeId?: string;
  requesterId?: string;
  categoryId?: string;
  customFieldValues?: { customFieldId: string; value?: string | null }[];
};

export type AddMessagePayload = {
  body: string;
  type?: string;
  authorId?: string;
};

export type AssignPayload = {
  assigneeId?: string;
};

export type TransitionPayload = {
  status: string;
};

export type TransferPayload = {
  newTeamId: string;
  assigneeId?: string;
};

export function getDemoUserEmail() {
  if (typeof window === 'undefined') {
    return DEFAULT_EMAIL ?? '';
  }
  return window.localStorage.getItem('demoUserEmail') ?? DEFAULT_EMAIL ?? '';
}

export function setDemoUserEmail(email: string) {
  if (typeof window === 'undefined') {
    return;
  }
  if (!email) {
    window.localStorage.removeItem('demoUserEmail');
    clearSearchCache();
    return;
  }
  const currentEmail = window.localStorage.getItem('demoUserEmail');
  if (currentEmail !== email) {
    // Clear search cache when persona changes to prevent leaking privileged data
    clearSearchCache();
  }
  window.localStorage.setItem('demoUserEmail', email);
}

export function setAuthToken(token: string | null) {
  authToken = token;
}

function authHeaders(): Record<string, string> {
  if (authToken) {
    return { Authorization: `Bearer ${authToken}` };
  }
  const email = getDemoUserEmail();
  // Dev-only fallback path. In production this is disabled server-side.
  return email ? { 'x-user-email': email } : {};
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options?.headers ?? {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new ApiError(message || 'Request failed', response.status);
  }

  return (await response.json()) as T;
}

type DataEnvelope<T> = { data: T };

function isDataEnvelope<T>(value: T | DataEnvelope<T>): value is DataEnvelope<T> {
  return typeof value === 'object' && value !== null && 'data' in value;
}

function unwrapDataEnvelope<T>(value: T | DataEnvelope<T>): T {
  return isDataEnvelope(value) ? value.data : value;
}

export function fetchTickets(params?: Record<string, string | number | undefined | string[]>) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === '') return;
      if (Array.isArray(value)) {
        if (value.length) query.set(key, value.join(','));
      } else {
        query.set(key, String(value));
      }
    });
  }

  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<TicketListResponse>(`/tickets${suffix}`);
}

export function fetchTicketCounts() {
  return apiFetch<{ assignedToMe: number; triage: number; open: number; unassigned: number }>('/tickets/counts');
}

export type TicketMetricsResponse = {
  total: number;
  open: number;
  resolved: number;
  byPriority: { P1: number; P2: number; P3: number; P4: number };
  byTeam: Array<{ teamId: string | null; total: number }>;
};

export function fetchTicketMetrics() {
  return apiFetch<TicketMetricsResponse>('/tickets/metrics');
}

export function fetchTicketActivity(params?: { from?: string; to?: string; scope?: 'assigned' }) {
  const query = new URLSearchParams();
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  if (params?.scope) query.set('scope', params.scope);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<{ data: TicketActivityPoint[] }>(`/tickets/activity${suffix}`);
}

export function fetchTicketStatusBreakdown(params?: {
  from?: string;
  to?: string;
  scope?: 'assigned';
  dateField?: 'createdAt' | 'updatedAt';
}) {
  const query = new URLSearchParams();
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  if (params?.scope) query.set('scope', params.scope);
  if (params?.dateField) query.set('dateField', params.dateField);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<{ data: TicketStatusPoint[] }>(`/tickets/status-breakdown${suffix}`);
}

export type SavedViewRecord = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  isDefault: boolean;
  userId: string | null;
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function fetchSavedViews() {
  return apiFetch<SavedViewRecord[] | DataEnvelope<SavedViewRecord[]>>('/saved-views')
    .then((response) => unwrapDataEnvelope(response));
}

export function createSavedView(payload: { name: string; filters: Record<string, unknown>; isDefault?: boolean; teamId?: string }) {
  return apiFetch<SavedViewRecord>('/saved-views', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSavedView(id: string, payload: { name?: string; filters?: Record<string, unknown>; isDefault?: boolean }) {
  return apiFetch<SavedViewRecord>(`/saved-views/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteSavedView(id: string) {
  return apiFetch<{ deleted: boolean }>(`/saved-views/${id}`, {
    method: 'DELETE',
  });
}

export type CannedResponseRecord = {
  id: string;
  name: string;
  content: string;
  userId: string | null;
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function fetchCannedResponses() {
  return apiFetch<CannedResponseRecord[] | DataEnvelope<CannedResponseRecord[]>>('/canned-responses')
    .then((response) => unwrapDataEnvelope(response));
}

export function createCannedResponse(payload: { name: string; content: string; teamId?: string }) {
  return apiFetch<CannedResponseRecord>('/canned-responses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCannedResponse(id: string, payload: { name?: string; content?: string }) {
  return apiFetch<CannedResponseRecord>(`/canned-responses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteCannedResponse(id: string) {
  return apiFetch<{ deleted: boolean }>(`/canned-responses/${id}`, {
    method: 'DELETE',
  });
}

export function fetchCustomFields(params?: { teamId?: string; categoryId?: string }) {
  const query = new URLSearchParams();
  if (params?.teamId) query.set('teamId', params.teamId);
  if (params?.categoryId) query.set('categoryId', params.categoryId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<{ data: CustomFieldRecord[] }>(`/custom-fields${suffix}`);
}

export function createCustomField(payload: {
  name: string;
  fieldType: string;
  options?: unknown;
  isRequired?: boolean;
  teamId?: string;
  categoryId?: string;
  sortOrder?: number;
}) {
  return apiFetch<CustomFieldRecord>('/custom-fields', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCustomField(
  id: string,
  payload: {
    name?: string;
    fieldType?: string;
    options?: unknown;
    isRequired?: boolean;
    teamId?: string | null;
    categoryId?: string | null;
    sortOrder?: number;
  },
) {
  return apiFetch<CustomFieldRecord>(`/custom-fields/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteCustomField(id: string) {
  return apiFetch<{ deleted: boolean }>(`/custom-fields/${id}`, {
    method: 'DELETE',
  });
}

export function setTicketCustomValues(
  ticketId: string,
  values: { customFieldId: string; value?: string | null }[],
) {
  return apiFetch<CustomFieldValueRecord[]>(`/custom-fields/tickets/${ticketId}/values`, {
    method: 'PATCH',
    body: JSON.stringify({ values }),
  });
}

export function fetchTicketById(id: string) {
  return apiFetch<TicketDetail>(`/tickets/${id}`);
}

export function fetchTicketMessages(id: string, params?: { cursor?: string; take?: number }) {
  const query = new URLSearchParams();
  if (params?.cursor) query.set('cursor', params.cursor);
  if (params?.take) query.set('take', String(params.take));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<TicketMessagePage>(`/tickets/${id}/messages${suffix}`);
}

export function fetchTicketEvents(id: string, params?: { cursor?: string; take?: number }) {
  const query = new URLSearchParams();
  if (params?.cursor) query.set('cursor', params.cursor);
  if (params?.take) query.set('take', String(params.take));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<TicketEventPage>(`/tickets/${id}/events${suffix}`);
}

export function fetchTicketFollowers(id: string) {
  return apiFetch<{ data: TicketFollower[] }>(`/tickets/${id}/followers`);
}

export function followTicket(id: string, userId?: string) {
  return apiFetch<{ data: TicketFollower[] }>(`/tickets/${id}/followers`, {
    method: 'POST',
    body: JSON.stringify(userId ? { userId } : {})
  });
}

export function unfollowTicket(id: string, userId: string = 'me') {
  return apiFetch<{ id: string }>(`/tickets/${id}/followers/${userId}`, {
    method: 'DELETE'
  });
}

export function createTicket(payload: CreateTicketPayload) {
  return apiFetch<TicketRecord>('/tickets', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function addTicketMessage(ticketId: string, payload: AddMessagePayload) {
  return apiFetch<TicketMessage>(`/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function uploadTicketAttachment(ticketId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_BASE}/tickets/${ticketId}/attachments`, {
    method: 'POST',
    headers: {
      ...authHeaders()
    },
    body: form
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Attachment upload failed');
  }

  return (await response.json()) as Attachment;
}

export async function downloadAttachment(attachmentId: string) {
  const response = await fetch(`${API_BASE}/attachments/${attachmentId}`, {
    headers: {
      ...authHeaders()
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Attachment download failed');
  }

  const blob = await response.blob();
  return blob;
}

export function assignTicket(ticketId: string, payload: AssignPayload) {
  return apiFetch<TicketRecord>(`/tickets/${ticketId}/assign`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function transitionTicket(ticketId: string, payload: TransitionPayload) {
  return apiFetch<TicketRecord>(`/tickets/${ticketId}/transition`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function transferTicket(ticketId: string, payload: TransferPayload) {
  return apiFetch<TicketRecord>(`/tickets/${ticketId}/transfer`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchTeams() {
  return apiFetch<{ data: TeamRef[] }>('/teams');
}

type FetchUsersParams = {
  role?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export function fetchUsers(params?: FetchUsersParams) {
  const query = new URLSearchParams();
  if (params?.role) query.set('role', params.role);
  if (params?.q) query.set('q', params.q);
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<{ data: UserRef[]; meta: PaginationMeta }>(`/users${suffix}`);
}

export function fetchCurrentUser() {
  return apiFetch<{ data: CurrentUserSession }>('/auth/me');
}

export function syncCurrentUserProfile(
  graphProfile: MicrosoftGraphProfile | null,
) {
  return apiFetch<{
    data: {
      id: string;
      email: string;
      displayName: string;
      department: string | null;
      location: string | null;
      graphProfile: unknown;
    } | null;
  }>('/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify({ graphProfile }),
  });
}

export async function fetchAllUsers(params?: Omit<FetchUsersParams, 'page'>) {
  const pageSize = Math.min(Math.max(params?.pageSize ?? 100, 1), 100);
  let page = 1;
  let totalPages = 1;
  const users: UserRef[] = [];

  while (page <= totalPages) {
    const response = await fetchUsers({
      ...params,
      page,
      pageSize
    });
    users.push(...response.data);
    totalPages = response.meta.totalPages;
    page += 1;
  }

  return { data: users };
}

export function fetchCategories(params?: { includeInactive?: boolean; q?: string; parentId?: string }) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        query.append(key, String(value));
      }
    });
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<{ data: CategoryRef[] }>(`/categories${suffix}`);
}

export function createCategory(payload: {
  name: string;
  slug?: string;
  description?: string;
  parentId?: string;
  isActive?: boolean;
}) {
  return apiFetch<CategoryRef>('/categories', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateCategory(id: string, payload: Partial<Omit<CategoryRef, 'id' | 'parent'>>) {
  return apiFetch<CategoryRef>(`/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function deleteCategory(id: string) {
  return apiFetch<{ id: string }>(`/categories/${id}`, {
    method: 'DELETE'
  });
}

export function fetchTeamMembers(teamId: string) {
  return apiFetch<{ data: TeamMember[] }>(`/teams/${teamId}/members`);
}

export function addTeamMember(teamId: string, payload: { userId: string; role?: string }) {
  return apiFetch<TeamMember>(`/teams/${teamId}/members`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateTeam(teamId: string, payload: { name?: string; slug?: string; description?: string; isActive?: boolean; assignmentStrategy?: string }) {
  return apiFetch<TeamRef>(`/teams/${teamId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function updateTeamMember(teamId: string, memberId: string, payload: { role: string }) {
  return apiFetch<TeamMember>(`/teams/${teamId}/members/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function removeTeamMember(teamId: string, memberId: string) {
  return apiFetch<{ id: string }>(`/teams/${teamId}/members/${memberId}`, {
    method: 'DELETE'
  });
}

export function fetchRoutingRules() {
  return apiFetch<{ data: RoutingRule[] }>('/routing-rules');
}

export function fetchSlaPolicies(teamId: string) {
  return apiFetch<{ data: SlaPolicy[] }>(`/slas?teamId=${teamId}`);
}

export function updateSlaPolicies(teamId: string, policies: Array<Omit<SlaPolicy, 'source'>>) {
  return apiFetch<{ data: SlaPolicy[] }>(`/slas/${teamId}`, {
    method: 'PUT',
    body: JSON.stringify({ policies })
  });
}

export function resetSlaPolicies(teamId: string) {
  return apiFetch<{ data: SlaPolicy[] }>(`/slas/${teamId}`, {
    method: 'DELETE'
  });
}

export function fetchSlaPolicyConfigs() {
  return apiFetch<{ data: SlaPolicyConfigRecord[] }>('/slas/policies');
}

export function createSlaPolicyConfig(payload: {
  name: string;
  description?: string;
  isDefault?: boolean;
  enabled?: boolean;
  businessHoursOnly?: boolean;
  escalationEnabled?: boolean;
  escalationAfterPercent?: number;
  breachNotifyRoles?: SlaPolicyNotifyRole[];
  appliedTeamIds?: string[];
  targets: Array<{
    priority: string;
    firstResponseHours: number;
    resolutionHours: number;
  }>;
}) {
  return apiFetch<{ data: SlaPolicyConfigRecord }>('/slas/policies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSlaPolicyConfig(
  policyId: string,
  payload: {
    name?: string;
    description?: string;
    isDefault?: boolean;
    enabled?: boolean;
    businessHoursOnly?: boolean;
    escalationEnabled?: boolean;
    escalationAfterPercent?: number;
    breachNotifyRoles?: SlaPolicyNotifyRole[];
    appliedTeamIds?: string[];
    targets?: Array<{
      priority: string;
      firstResponseHours: number;
      resolutionHours: number;
    }>;
  },
) {
  return apiFetch<{ data: SlaPolicyConfigRecord }>(`/slas/policies/${policyId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteSlaPolicyConfig(policyId: string) {
  return apiFetch<{ id: string }>(`/slas/policies/${policyId}`, {
    method: 'DELETE',
  });
}

export function fetchSlaBusinessHoursSettings() {
  return apiFetch<{ data: SlaBusinessHoursSettings }>('/slas/settings');
}

export function updateSlaBusinessHoursSettings(payload: {
  timezone?: string;
  schedule?: SlaBusinessDayRecord[];
  holidays?: SlaHolidayRecord[];
}) {
  return apiFetch<{ data: SlaBusinessHoursSettings }>('/slas/settings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function createRoutingRule(payload: {
  name: string;
  keywords: string[];
  teamId?: string;
  assigneeId?: string;
  priority?: number;
  isActive?: boolean;
}) {
  return apiFetch<RoutingRule>('/routing-rules', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateRoutingRule(
  id: string,
  payload: {
    name?: string;
    keywords?: string[];
    teamId?: string;
    assigneeId?: string;
    priority?: number;
    isActive?: boolean;
  },
) {
  return apiFetch<RoutingRule>(`/routing-rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function deleteRoutingRule(id: string) {
  return apiFetch<{ id: string }>(`/routing-rules/${id}`, {
    method: 'DELETE'
  });
}

// Automation rules
export type AutomationCondition = {
  field?: string;
  operator?: string;
  value?: unknown;
  and?: AutomationCondition[];
  or?: AutomationCondition[];
};

export type AutomationAction = {
  type: string;
  teamId?: string;
  userId?: string;
  priority?: string;
  status?: string;
  body?: string;
};

export type AutomationRule = {
  id: string;
  name: string;
  description?: string | null;
  trigger: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  isActive: boolean;
  priority: number;
  teamId?: string | null;
  team?: TeamRef | null;
  createdBy?: { id: string; displayName: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
};

export function fetchAutomationRules() {
  return apiFetch<{ data: AutomationRule[] }>('/automation-rules');
}

export function createAutomationRule(payload: {
  name: string;
  description?: string;
  trigger: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  isActive?: boolean;
  priority?: number;
  teamId?: string;
}) {
  return apiFetch<AutomationRule>('/automation-rules', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateAutomationRule(
  id: string,
  payload: Partial<Omit<AutomationRule, 'id' | 'team' | 'createdBy' | 'createdAt' | 'updatedAt'>>
) {
  return apiFetch<AutomationRule>(`/automation-rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function deleteAutomationRule(id: string) {
  return apiFetch<{ id: string }>(`/automation-rules/${id}`, {
    method: 'DELETE'
  });
}

export function testAutomationRule(ruleId: string, ticketId: string) {
  return apiFetch<{
    matched: boolean;
    actionsThatWouldRun: AutomationAction[];
    message: string;
  }>(`/automation-rules/${ruleId}/test`, {
    method: 'POST',
    body: JSON.stringify({ ticketId })
  });
}

export function fetchAutomationRuleExecutions(ruleId: string, page = 1, pageSize = 20) {
  return apiFetch<{
    data: Array<{
      id: string;
      ruleId: string;
      ticketId: string;
      success: boolean;
      error?: string | null;
      executedAt: string;
      ticket?: { id: string; number: number; displayId: string | null; subject: string };
    }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }>(`/automation-rules/${ruleId}/executions?page=${page}&pageSize=${pageSize}`);
}

// Search types and function
export type SearchResults = {
  tickets: Array<{
    id: string;
    number: number;
    displayId?: string | null;
    subject: string;
    status: string;
    priority: string;
    assignedTeam?: TeamRef | null;
  }>;
  users: UserRef[];
  teams: TeamRef[];
};

// Cache for users and teams to avoid hammering the API on every keystroke
// Keyed by user email to prevent leaking data across persona switches
let cachedUsers: UserRef[] | null = null;
let cachedTeams: TeamRef[] | null = null;
let usersCacheTime = 0;
let teamsCacheTime = 0;
let cacheUserEmail: string | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearSearchCache() {
  cachedUsers = null;
  cachedTeams = null;
  usersCacheTime = 0;
  teamsCacheTime = 0;
  cacheUserEmail = null;
}

/**
 * Check if cache is valid for current user, clear if user changed
 */
function validateCacheUser(): void {
  const currentEmail = getDemoUserEmail();
  if (cacheUserEmail !== null && cacheUserEmail !== currentEmail) {
    // User changed, clear cache to prevent leaking privileged data
    clearSearchCache();
  }
  cacheUserEmail = currentEmail;
}

async function getCachedUsers(): Promise<UserRef[]> {
  validateCacheUser();
  const now = Date.now();
  if (cachedUsers && now - usersCacheTime < CACHE_TTL_MS) {
    return cachedUsers;
  }
  try {
    const response = await fetchUsers();
    cachedUsers = response.data;
    usersCacheTime = now;
    return cachedUsers;
  } catch {
    // Return cached data if available, empty array otherwise
    return cachedUsers ?? [];
  }
}

async function getCachedTeams(): Promise<TeamRef[]> {
  validateCacheUser();
  const now = Date.now();
  if (cachedTeams && now - teamsCacheTime < CACHE_TTL_MS) {
    return cachedTeams;
  }
  try {
    const response = await fetchTeams();
    cachedTeams = response.data;
    teamsCacheTime = now;
    return cachedTeams;
  } catch {
    // Return cached data if available, empty array otherwise
    return cachedTeams ?? [];
  }
}

export async function searchAll(
  query: string,
  signal?: AbortSignal
): Promise<SearchResults> {
  // Check if aborted before starting
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // Perform parallel searches across tickets, users (cached), and teams (cached)
  const [ticketsResponse, users, teams] = await Promise.all([
    fetchTickets({ q: query, pageSize: 5 }).catch(() => ({ data: [] })),
    getCachedUsers(),
    getCachedTeams()
  ]);

  // Check if aborted after fetching
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // Filter users and teams client-side based on query
  const loweredQuery = query.toLowerCase();
  
  const filteredUsers = users.filter(
    (user) =>
      user.displayName.toLowerCase().includes(loweredQuery) ||
      user.email.toLowerCase().includes(loweredQuery)
  ).slice(0, 5);

  const filteredTeams = teams.filter(
    (team) => team.name.toLowerCase().includes(loweredQuery)
  ).slice(0, 5);

  return {
    tickets: ticketsResponse.data.map((t) => ({
      id: t.id,
      number: t.number,
      displayId: t.displayId,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      assignedTeam: t.assignedTeam
    })),
    users: filteredUsers,
    teams: filteredTeams
  };
}

// ============================================
// Notification types and functions
// ============================================

export type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  ticket?: {
    id: string;
    number: number;
    displayId: string | null;
    subject: string;
  } | null;
  actor?: UserRef | null;
};

export type NotificationListResponse = {
  data: NotificationRecord[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    unreadCount: number;
  };
};

export function fetchNotifications(params?: {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        query.append(key, String(value));
      }
    });
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<NotificationListResponse>(`/notifications${suffix}`);
}

export function fetchUnreadNotificationCount() {
  return apiFetch<{ count: number } | DataEnvelope<{ count: number }>>('/notifications/unread-count')
    .then((response) => unwrapDataEnvelope(response));
}

export function markNotificationAsRead(notificationId: string) {
  return apiFetch<{ success: boolean } | DataEnvelope<{ success: boolean }>>(
    `/notifications/${notificationId}/read`,
    {
      method: 'PATCH'
    },
  ).then((response) => unwrapDataEnvelope(response));
}

export function markAllNotificationsAsRead() {
  return apiFetch<
    { success: boolean; count: number } | DataEnvelope<{ success: boolean; count: number }>
  >('/notifications/read-all', {
    method: 'PATCH'
  }).then((response) => unwrapDataEnvelope(response));
}

// ============================================
// Bulk ticket actions
// ============================================

export type BulkResult = {
  success: number;
  failed: number;
  errors: Array<{ ticketId: string; message: string }>;
};

export function bulkAssignTickets(ticketIds: string[], assigneeId?: string) {
  return apiFetch<BulkResult | DataEnvelope<BulkResult>>('/tickets/bulk/assign', {
    method: 'POST',
    body: JSON.stringify({ ticketIds, assigneeId })
  }).then((response) => unwrapDataEnvelope(response));
}

export function bulkTransferTickets(ticketIds: string[], newTeamId: string, assigneeId?: string) {
  return apiFetch<BulkResult | DataEnvelope<BulkResult>>('/tickets/bulk/transfer', {
    method: 'POST',
    body: JSON.stringify({ ticketIds, newTeamId, assigneeId })
  }).then((response) => unwrapDataEnvelope(response));
}

export function bulkStatusTickets(ticketIds: string[], status: string) {
  return apiFetch<BulkResult | DataEnvelope<BulkResult>>('/tickets/bulk/status', {
    method: 'POST',
    body: JSON.stringify({ ticketIds, status })
  }).then((response) => unwrapDataEnvelope(response));
}

export function bulkPriorityTickets(ticketIds: string[], priority: string) {
  return apiFetch<BulkResult | DataEnvelope<BulkResult>>('/tickets/bulk/priority', {
    method: 'POST',
    body: JSON.stringify({ ticketIds, priority })
  }).then((response) => unwrapDataEnvelope(response));
}

// ============================================
// Reports
// ============================================

export type ReportQuery = {
  from?: string;
  to?: string;
  teamId?: string;
  priority?: string;
  categoryId?: string;
  channel?: string;
  status?: string;
  assigneeId?: string;
  groupBy?: 'team' | 'priority';
  scope?: 'assigned';
  dateField?: 'createdAt' | 'updatedAt';
  statusGroup?: 'open' | 'resolved' | 'all';
};

export type TicketVolumeResponse = { data: { date: string; count: number }[] };
export type SlaComplianceResponse = {
  data: {
    met: number;
    breached: number;
    total: number;
    firstResponseMet: number;
    firstResponseBreached: number;
    resolutionMet: number;
    resolutionBreached: number;
  };
};
export type SlaComplianceByPriorityResponse = {
  data: Array<{
    priority: string;
    met: number;
    breached: number;
    total: number;
    firstResponseMet: number;
    firstResponseBreached: number;
    resolutionMet: number;
    resolutionBreached: number;
  }>;
};
export type ResolutionTimeResponse = {
  data: { label: string; id?: string; avgHours: number; count: number }[];
};
export type TicketsByStatusResponse = { data: { status: string; count: number }[] };
export type TicketsByPriorityResponse = { data: { priority: string; count: number }[] };
export type AgentPerformanceResponse = {
  data: {
    userId: string;
    name: string;
    email: string;
    ticketsResolved: number;
    avgResolutionHours: number | null;
    firstResponses: number;
    avgFirstResponseHours: number | null;
  }[];
};
export type AgentWorkloadResponse = {
  data: {
    userId: string;
    name: string;
    email: string;
    assignedOpen: number;
    inProgress: number;
  }[];
};
export type TicketAgeBucketResponse = {
  data: { bucket: string; count: number }[];
};
export type ReopenRateResponse = {
  data: { date: string; count: number }[];
};
export type CsatTrendResponse = {
  data: { date: string; average: number; count: number }[];
  summary: { average: number | null; responses: number };
};
export type CsatDriversResponse = {
  data: { label: string; count: number; percent: number }[];
  total: number;
};
export type CsatLowTagsResponse = {
  data: { tag: string; count: number }[];
};
export type SlaBreachesResponse = {
  data: {
    ticketId: string;
    ticket: string;
    team: string;
    priority: string;
    stage: string;
    breachSeconds: number;
    reason: string;
  }[];
};
export type ChannelBreakdownResponse = {
  data: { channel: string; label: string; count: number; percent: number }[];
  total: number;
};
export type TicketsByCategoryResponse = {
  data: { id: string; name: string; count: number }[];
};
export type TeamSummaryResponse = {
  data: { id: string; name: string; open: number; resolved: number; total: number }[];
};
export type TransfersResponse = {
  data: { total: number; series: { date: string; count: number }[] };
};

export type ReportSummaryResponse = {
  ticketVolume: TicketVolumeResponse;
  slaCompliance: SlaComplianceResponse;
  resolutionTime: ResolutionTimeResponse;
  ticketsByPriority: TicketsByPriorityResponse;
  ticketsByStatus: TicketsByStatusResponse;
  agentPerformance: AgentPerformanceResponse;
};

function reportQueryString(params: ReportQuery): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === '') return;
    if (Array.isArray(v)) {
      if (v.length > 0) q.set(k, v.join(','));
      return;
    }
    q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function fetchReportTicketVolume(params: ReportQuery) {
  return apiFetch<TicketVolumeResponse>(`/reports/ticket-volume${reportQueryString(params)}`);
}
export function fetchReportSummary(params: ReportQuery) {
  // Server defaults resolutionTime.groupBy to "team" for the summary response.
  return apiFetch<ReportSummaryResponse>(`/reports/summary${reportQueryString(params)}`);
}
export function fetchReportSlaCompliance(params: ReportQuery) {
  return apiFetch<SlaComplianceResponse>(`/reports/sla-compliance${reportQueryString(params)}`);
}
export function fetchReportSlaComplianceByPriority(params: ReportQuery) {
  return apiFetch<SlaComplianceByPriorityResponse>(
    `/reports/sla-compliance-by-priority${reportQueryString(params)}`,
  );
}
export function fetchReportResolutionTime(params: ReportQuery) {
  return apiFetch<ResolutionTimeResponse>(`/reports/resolution-time${reportQueryString(params)}`);
}
export function fetchReportTicketsByStatus(params: ReportQuery) {
  return apiFetch<TicketsByStatusResponse>(`/reports/tickets-by-status${reportQueryString(params)}`);
}
export function fetchReportTicketsByPriority(params: ReportQuery) {
  return apiFetch<TicketsByPriorityResponse>(`/reports/tickets-by-priority${reportQueryString(params)}`);
}
export function fetchReportAgentPerformance(params: ReportQuery) {
  return apiFetch<AgentPerformanceResponse>(`/reports/agent-performance${reportQueryString(params)}`);
}
export function fetchReportAgentWorkload(params: ReportQuery) {
  return apiFetch<AgentWorkloadResponse>(`/reports/agent-workload${reportQueryString(params)}`);
}
export function fetchReportTicketsByAge(params: ReportQuery) {
  return apiFetch<TicketAgeBucketResponse>(`/reports/tickets-by-age${reportQueryString(params)}`);
}
export function fetchReportReopenRate(params: ReportQuery) {
  return apiFetch<ReopenRateResponse>(`/reports/reopen-rate${reportQueryString(params)}`);
}
export function fetchReportCsatTrend(params: ReportQuery) {
  return apiFetch<CsatTrendResponse>(`/reports/csat-trend${reportQueryString(params)}`);
}
export function fetchReportCsatDrivers(params: ReportQuery) {
  return apiFetch<CsatDriversResponse>(`/reports/csat-drivers${reportQueryString(params)}`);
}
export function fetchReportCsatLowTags(params: ReportQuery) {
  return apiFetch<CsatLowTagsResponse>(`/reports/csat-low-tags${reportQueryString(params)}`);
}
export function fetchReportSlaBreaches(params: ReportQuery) {
  return apiFetch<SlaBreachesResponse>(`/reports/sla-breaches${reportQueryString(params)}`);
}
export function fetchReportChannelBreakdown(params: ReportQuery) {
  return apiFetch<ChannelBreakdownResponse>(`/reports/channel-breakdown${reportQueryString(params)}`);
}
export function fetchReportTicketsByCategory(params: ReportQuery) {
  return apiFetch<TicketsByCategoryResponse>(`/reports/tickets-by-category${reportQueryString(params)}`);
}
export function fetchReportTeamSummary(params: ReportQuery) {
  return apiFetch<TeamSummaryResponse>(`/reports/team-summary${reportQueryString(params)}`);
}
export function fetchReportTransfers(params: ReportQuery) {
  return apiFetch<TransfersResponse>(`/reports/transfers${reportQueryString(params)}`);
}

// ——— Audit Log ———
export type AuditLogEntry = {
  id: string;
  ticketId: string;
  ticketNumber: number;
  ticketDisplayId: string | null;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  createdById: string | null;
  createdBy: { id: string; displayName: string; email: string } | null;
};

export type AuditLogParams = {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type AuditLogCategoryCounts = {
  sla: number;
  routing: number;
  automation: number;
  custom_fields: number;
};

export type AuditLogResponse = {
  data: AuditLogEntry[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    categoryCounts?: AuditLogCategoryCounts;
  };
};

export function fetchAuditLog(params?: AuditLogParams) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === '') return;
      query.set(key, String(value));
    });
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<AuditLogResponse>(`/audit-log${suffix}`);
}

export async function fetchAuditLogExport(params?: Omit<AuditLogParams, 'page' | 'pageSize'>): Promise<string> {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === '') return;
      query.set(key, String(value));
    });
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await fetch(`${API_BASE}/audit-log/export${suffix}`, {
    headers: { ...authHeaders() },
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = raw || 'Export failed';
    try {
      const body = JSON.parse(raw) as { message?: string };
      if (typeof body?.message === 'string') message = body.message;
    } catch {
      // not JSON
    }
    throw new ApiError(message, response.status);
  }
  return response.text();
}
