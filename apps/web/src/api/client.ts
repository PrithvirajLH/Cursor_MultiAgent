import { isAbortError } from "./is-abort-error";
import { sessionExpiryStore } from "./session-expiry-store";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const DEFAULT_EMAIL = import.meta.env.VITE_DEMO_USER_EMAIL as
  | string
  | undefined;
let authToken: string | null = null;
let tokenRefresher: (() => Promise<string | null>) | null = null;
let tokenRefreshInFlight: Promise<string | null> | null = null;
let onAuthFailure: (() => void) | null = null;
let authFailureFired = false;

type ApiGetCacheEntry = {
  data: unknown;
  cachedAt: number;
  etag: string | null;
  lastModified: string | null;
};

const HOT_GET_CACHE_TTL_MS = 15 * 1000;
const API_REQUEST_TIMEOUT_MS = 30 * 1000;
const MAX_GET_CACHE_ENTRIES = 300;
const apiGetCache = new Map<string, ApiGetCacheEntry>();
const apiGetInflight = new Map<string, Promise<unknown>>();

function clearApiGetCache() {
  apiGetCache.clear();
  apiGetInflight.clear();
}

/**
 * Invalidate cached GET entries whose path shares the same resource root as
 * the mutated path.  For example, a POST to `/tickets/abc/messages` will
 * clear caches for `/tickets`, `/tickets/abc`, `/tickets/abc/messages`, and
 * also `/tickets/counts` — but will NOT clear `/teams` or `/categories`.
 *
 * Falls back to a full clear if the path doesn't start with '/'.
 */
function invalidateApiCacheByPath(mutatedPath: string) {
  // Extract the resource root: '/tickets/abc/messages' → '/tickets'
  const segments = mutatedPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    clearApiGetCache();
    return;
  }
  const resourceRoot = `/${segments[0]}`;
  const scope = cacheScopeKey();
  const prefix = `${scope}:${resourceRoot}`;

  for (const key of apiGetCache.keys()) {
    if (key.startsWith(prefix)) {
      apiGetCache.delete(key);
    }
  }
  // Also invalidate /counts since it aggregates across resources
  const countsPrefix = `${scope}:/counts`;
  for (const key of apiGetCache.keys()) {
    if (key.startsWith(countsPrefix)) {
      apiGetCache.delete(key);
    }
  }
}

/**
 * Drop the cached sidebar badge counts.
 *
 * Counts only, deliberately: clearing the whole `/tickets` prefix would make
 * every open list re-fetch on every realtime event. Invalidating the react
 * query alone is not enough - its refetch would be answered by the hot GET
 * cache below for up to HOT_GET_CACHE_TTL_MS.
 */
export function invalidateTicketCountsCache() {
  const prefix = `${cacheScopeKey()}:/tickets/counts`;
  for (const key of apiGetCache.keys()) {
    if (key.startsWith(prefix)) {
      apiGetCache.delete(key);
    }
  }
}

/** Thrown by apiFetch when response is not ok; includes status for UI (e.g. 403). */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type ApiErrorBody = {
  message?: string | string[];
  error?: string;
};

function formatApiErrorMessage(raw: string, fallback: string): string {
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as ApiErrorBody;
    if (Array.isArray(parsed.message)) {
      const messages = parsed.message.filter(
        (message): message is string =>
          typeof message === "string" && message.trim().length > 0,
      );
      if (messages.length > 0) {
        return messages.join(". ");
      }
    }
    if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
      return parsed.message;
    }
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    // keep raw response text
  }

  return raw || fallback;
}

export type UserRef = {
  id: string;
  email: string;
  displayName: string;
  role?: string;
  department?: string | null;
  location?: string | null;
  primaryTeamId?: string | null;
  isActive?: boolean;
  deactivatedAt?: string | null;
  graphProfile?: {
    jobTitle?: string | null;
    officeLocation?: string | null;
  } | null;
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
  teamName?: string | null;
  teamRole: string | null;
  primaryTeamId: string | null;
  graphProfile?: MicrosoftGraphProfile | null;
  avatarDataUrl?: string | null;
};

export type TeamRef = {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  assignmentStrategy?: string;
  isActive?: boolean;
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

export type RoutingConditionField =
  | "subject"
  | "message"
  | "priority"
  | "category"
  | "channel"
  | "sender";
export type RoutingConditionOp = "contains" | "not_contains" | "is" | "is_not";
export type RoutingActionType =
  | "assign_team"
  | "assign_member"
  | "set_priority"
  | "add_tag";
export type RoutingMatchType = "ALL" | "ANY";
export type RoutingCondition = {
  field: RoutingConditionField;
  op: RoutingConditionOp;
  value: string;
};
export type RoutingActionItem = { type: RoutingActionType; value: string };

export type RoutingRule = {
  id: string;
  name: string;
  keywords: string[];
  teamId: string;
  assigneeId?: string | null;
  priority: number;
  isActive: boolean;
  matchType?: RoutingMatchType;
  conditions?: RoutingCondition[];
  actions?: RoutingActionItem[];
  team?: TeamRef;
  assignee?: UserRef | null;
};

export type TicketStatus =
  | "NEW"
  | "TRIAGED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "WAITING_ON_REQUESTER"
  | "WAITING_ON_VENDOR"
  | "RESOLVED"
  | "CLOSED"
  | "REOPENED";
export type TicketPriority = "SEV1" | "SEV2" | "SEV3" | "SEV4";
export type TicketChannel = "PORTAL" | "EMAIL" | "API" | "AGENT_PORTAL";

/** Why a closed ticket closed (mirrors the API's TicketCloseReason enum). */
export type TicketCloseReason =
  | "REQUESTER_CONFIRMED"
  | "REQUESTER_CANCELLED"
  | "AGENT_CLOSED"
  | "AUTO_CLOSED";

export type TicketRecord = {
  id: string;
  number: number;
  displayId?: string | null;
  subject: string;
  description?: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  channel?: TicketChannel;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  closedAt?: string | null;
  closeReason?: TicketCloseReason | null;
  completedAt?: string | null;
  requester?: UserRef | null;
  assignee?: UserRef | null;
  assignedTeam?: TeamRef | null;
  category?: CategoryRef | null;
  dueAt?: string | null;
  /**
   * "Remind me Friday" (card 1.10). Comes off the row, so the overdue badge
   * survives a reload; the scheduler clears it when the reminder fires.
   */
  followUpAt?: string | null;
  firstResponseDueAt?: string | null;
  firstResponseAt?: string | null;
  slaPausedAt?: string | null;
  /** Set when the ticket is soft-deleted; only OWNER ever receives such a record. */
  deletedAt?: string | null;
  allowedTransitions?: string[];
  /**
   * True when the last PUBLIC message on the ticket came from the requester,
   * so the next move is ours (card 1.29).
   *
   * Computed on the server, per row, from the actual messages — not from the
   * status, and not in the browser. A badge derived client-side would not
   * survive a reload, which is the entire point of showing it.
   */
  awaitingAgentReply?: boolean;
};

export type TicketMessage = {
  id: string;
  body: string;
  type: string;
  createdAt: string;
  author: UserRef;
  /**
   * What actually happened to this message's email (card 1.28, 6c). Reports
   * the outbox, not the intent: a label reading "emailed to 3" when the send
   * failed is worse than no label, because the agent stops chasing.
   */
  /**
   * `pending` is card 1.47: production's sweeper delivers on a 60-second
   * interval, so a reply can be queued-but-unsent for most of a minute. The
   * redaction dialog needs to know, or it says nothing was emailed and then
   * the email goes out.
   */
  delivery?: {
    emailed: number;
    refused: number;
    pending?: number;
    internal: boolean;
  };
  /**
   * Card 1.11. Set once the message has been removed; `body` is then the
   * "[message removed by ...]" marker and the original text no longer exists.
   */
  redactedAt?: string | null;
  redactedById?: string | null;
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

export type TicketLinkType = "RELATED" | "DUPLICATE_OF" | "PARENT_OF";

/**
 * One link between two tickets (card 1.6).
 *
 * Only ONE row is stored per relationship; `direction` is what the server
 * derived for the ticket being read, and it is what lets the same stored row
 * render as "Duplicate of" on one ticket and "Duplicated by" on the other.
 *
 * `otherTicket.visible` is false when the reader may not open the linked
 * ticket. Every descriptive field is then null and only `number` remains - the
 * link is still shown, because an agent needs to know the ticket was linked,
 * but its subject is withheld.
 */
export type TicketLinkRecord = {
  id: string;
  type: TicketLinkType;
  direction: "outgoing" | "incoming";
  createdAt: string;
  createdBy?: { id: string; displayName: string } | null;
  otherTicket: {
    id: string;
    number: number;
    visible: boolean;
    deleted: boolean;
    displayId: string | null;
    subject: string | null;
    status: TicketStatus | null;
    priority: TicketPriority | null;
  };
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
  links?: TicketLinkRecord[];
  attachments: Attachment[];
  customFieldValues?: CustomFieldValueRecord[];
  allowedTransitions?: string[];
  tags?: TagRef[];
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
  priority: TicketPriority;
  firstResponseHours: number;
  resolutionHours: number;
  source?: "team" | "default";
};

export type SlaPolicyNotifyRole = "AGENT" | "LEAD" | "MANAGER" | "OWNER";

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
    priority: TicketPriority;
    firstResponseHours: number;
    resolutionHours: number;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type SlaBusinessDayRecord = {
  day:
    | "Monday"
    | "Tuesday"
    | "Wednesday"
    | "Thursday"
    | "Friday"
    | "Saturday"
    | "Sunday";
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
  status: TicketStatus;
  count: number;
};

export type CreateTicketPayload = {
  subject: string;
  description: string;
  priority?: TicketPriority;
  channel?: TicketChannel;
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
  status: TicketStatus;
};

export type TransferPayload = {
  newTeamId: string;
  assigneeId?: string;
};

export function getDemoUserEmail() {
  if (typeof window === "undefined") {
    return DEFAULT_EMAIL ?? "";
  }
  return window.localStorage.getItem("demoUserEmail") ?? DEFAULT_EMAIL ?? "";
}

export function setDemoUserEmail(email: string) {
  if (typeof window === "undefined") {
    return;
  }
  if (!email) {
    window.localStorage.removeItem("demoUserEmail");
    clearApiGetCache();
    clearSearchCache();
    return;
  }
  const currentEmail = window.localStorage.getItem("demoUserEmail");
  if (currentEmail !== email) {
    // Clear search cache when persona changes to prevent leaking privileged data
    clearApiGetCache();
    clearSearchCache();
  }
  window.localStorage.setItem("demoUserEmail", email);
}

export function setAuthToken(token: string | null) {
  if (authToken !== token) {
    clearApiGetCache();
    clearSearchCache();
  }
  authToken = token;
}

/**
 * Registers a callback that can silently acquire a fresh token.
 * Called by useAuthSession after MSAL is initialized.
 */
export function setTokenRefresher(fn: (() => Promise<string | null>) | null) {
  tokenRefresher = fn;
}

/**
 * Registers a callback invoked when auth fails even after token refresh.
 * Typically triggers re-login.
 */
export function setOnAuthFailure(fn: (() => void) | null) {
  onAuthFailure = fn;
  authFailureFired = false;
}

/**
 * Hand control to the re-login flow, at most once per failed session (card 1.54).
 *
 * ⚠️ THE LATCH IS DELIBERATE — it stops ten simultaneous 401s becoming ten
 * `loginRedirect` calls. But it was reset ONLY by `setOnAuthFailure`, which runs
 * once when MSAL initialises, so after the first auth failure in a page session
 * the redirect could never fire again. That is the dead panel the owner
 * photographed: the session expires a second time and nothing happens.
 *
 * The fix is to reset the latch when a request SUCCEEDS (see `noteRequestSucceeded`)
 * rather than to remove it. A successful response is proof the session recovered,
 * and therefore that the next failure is a new one worth redirecting for.
 */
function fireAuthFailure() {
  sessionExpiryStore.set(true);
  if (authFailureFired || !onAuthFailure) return;
  authFailureFired = true;
  onAuthFailure();
}

/**
 * Record that the API accepted this session (card 1.54).
 *
 * Clears the expiry banner and re-arms the auth-failure latch. Called on every
 * successful response, including a 304, because a conditional hit is just as
 * much proof that the credential was accepted.
 */
function noteRequestSucceeded() {
  authFailureFired = false;
  sessionExpiryStore.set(false);
}

/**
 * Attempts to refresh the auth token. Deduplicates concurrent calls.
 * Returns the new token or null if refresh failed.
 */
async function tryRefreshToken(): Promise<string | null> {
  if (!tokenRefresher) return null;
  if (tokenRefreshInFlight) return tokenRefreshInFlight;

  tokenRefreshInFlight = tokenRefresher().then(
    (newToken) => {
      tokenRefreshInFlight = null;
      if (newToken) {
        authToken = newToken;
      }
      return newToken;
    },
    () => {
      tokenRefreshInFlight = null;
      return null;
    },
  );

  return tokenRefreshInFlight;
}

function authHeaders(): Record<string, string> {
  if (authToken) {
    return { Authorization: `Bearer ${authToken}` };
  }
  const email = getDemoUserEmail();
  // Dev-only fallback path. In production this is disabled server-side.
  return email ? { "x-user-email": email } : {};
}

function cacheScopeKey() {
  if (authToken) {
    return "authenticated";
  }
  return `demo:${getDemoUserEmail().trim().toLowerCase()}`;
}

function getApiCacheKey(path: string) {
  return `${cacheScopeKey()}:${path}`;
}

function setApiCacheEntry(cacheKey: string, entry: ApiGetCacheEntry) {
  if (apiGetCache.size >= MAX_GET_CACHE_ENTRIES && !apiGetCache.has(cacheKey)) {
    const oldestKey = apiGetCache.keys().next().value;
    if (oldestKey) {
      apiGetCache.delete(oldestKey);
    }
  }
  apiGetCache.set(cacheKey, entry);
}

function requestMethod(options?: RequestInit) {
  return (options?.method ?? "GET").toUpperCase();
}

function buildRequestHeaders(optionsHeaders?: HeadersInit): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  for (const [key, value] of Object.entries(authHeaders())) {
    headers.set(key, value);
  }
  if (optionsHeaders) {
    const providedHeaders = new Headers(optionsHeaders);
    providedHeaders.forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

async function fetchWithTimeout(
  input: string,
  options?: RequestInit & { timeoutMs?: number },
) {
  const timeoutMs = options?.timeoutMs ?? API_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const upstreamSignal = options?.signal;
  const abortFromUpstream = () => controller.abort();

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, {
        once: true,
      });
    }
  }

  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new ApiError("Request timed out", 408);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const method = requestMethod(options);
  const isGetRequest = method === "GET";
  const cacheableGet = isGetRequest && options?.cache !== "no-store";
  const requestHeaders = buildRequestHeaders(options?.headers);
  const requestInit: RequestInit = {
    ...options,
    method,
    headers: requestHeaders,
  };

  if (!cacheableGet) {
    let response = await fetchWithTimeout(`${API_BASE}${path}`, requestInit);

    // On 401, try refreshing the token and retry once
    if (response.status === 401) {
      if (tokenRefresher) {
        const newToken = await tryRefreshToken();
        if (newToken) {
          const retryHeaders = buildRequestHeaders(options?.headers);
          response = await fetchWithTimeout(`${API_BASE}${path}`, {
            ...options,
            method,
            headers: retryHeaders,
          });
        }
      }
      // If still 401 after retry (or no refresher), trigger re-auth
      if (response.status === 401) {
        fireAuthFailure();
      }
    }

    if (!response.ok) {
      const raw = await response.text();
      throw new ApiError(
        formatApiErrorMessage(raw, "Request failed"),
        response.status,
      );
    }
    const payload = (await response.json()) as T;
    noteRequestSucceeded();
    if (!isGetRequest) {
      invalidateApiCacheByPath(path);
    }
    return payload;
  }

  const cacheKey = getApiCacheKey(path);
  const cached = apiGetCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.cachedAt <= HOT_GET_CACHE_TTL_MS) {
    return cached.data as T;
  }

  const inflight = apiGetInflight.get(cacheKey);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const conditionalHeaders = new Headers(requestHeaders);
  if (cached?.etag) {
    conditionalHeaders.set("If-None-Match", cached.etag);
  }
  if (cached?.lastModified) {
    conditionalHeaders.set("If-Modified-Since", cached.lastModified);
  }

  const requestPromise = (async () => {
    try {
      let response = await fetchWithTimeout(`${API_BASE}${path}`, {
        ...requestInit,
        headers: conditionalHeaders,
      });

      // On 401, try refreshing the token and retry once
      if (response.status === 401) {
        if (tokenRefresher) {
          const newToken = await tryRefreshToken();
          if (newToken) {
            const retryHeaders = buildRequestHeaders(options?.headers);
            if (cached?.etag) retryHeaders.set("If-None-Match", cached.etag);
            if (cached?.lastModified) retryHeaders.set("If-Modified-Since", cached.lastModified);
            response = await fetchWithTimeout(`${API_BASE}${path}`, {
              ...requestInit,
              headers: retryHeaders,
            });
          }
        }
        // ⚠️ Card 1.54: this called `onAuthFailure()` DIRECTLY, bypassing the
        // latch in `fireAuthFailure`. Ten sidebar count queries share this
        // path, so one expired token produced ten `loginRedirect` calls -
        // precisely the storm the latch was added to prevent.
        if (response.status === 401) {
          fireAuthFailure();
        }
      }

      if (response.status === 304 && cached) {
        noteRequestSucceeded();
        const refreshedCacheEntry: ApiGetCacheEntry = {
          ...cached,
          cachedAt: Date.now(),
        };
        setApiCacheEntry(cacheKey, refreshedCacheEntry);
        return refreshedCacheEntry.data as T;
      }

      if (!response.ok) {
        const raw = await response.text();
        throw new ApiError(
          formatApiErrorMessage(raw, "Request failed"),
          response.status,
        );
      }

      const payload = (await response.json()) as T;
      noteRequestSucceeded();
      setApiCacheEntry(cacheKey, {
        data: payload,
        cachedAt: Date.now(),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      });
      return payload;
    } finally {
      // Ensure cleanup always happens strictly when the promise settles,
      // avoiding memory leaks from outer async context retention.
      apiGetInflight.delete(cacheKey);
    }
  })();

  apiGetInflight.set(cacheKey, requestPromise as Promise<unknown>);
  return requestPromise;
}

type DataEnvelope<T> = { data: T };

function isDataEnvelope<T>(
  value: T | DataEnvelope<T>,
): value is DataEnvelope<T> {
  return typeof value === "object" && value !== null && "data" in value;
}

function unwrapDataEnvelope<T>(value: T | DataEnvelope<T>): T {
  return isDataEnvelope(value) ? value.data : value;
}

export function fetchTickets(
  params?: Record<string, string | number | boolean | undefined | string[]>,
  // `cache` is here so a caller that exists to discover what it missed (the
  // ticket list's reconnect refetch) can pass "no-store" and skip the 15s hot
  // GET cache, which would otherwise hand it the snapshot it is replacing.
  options?: Pick<RequestInit, "signal" | "cache">,
) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === "") return;
      if (Array.isArray(value)) {
        if (value.length) query.set(key, value.join(","));
      } else {
        query.set(key, String(value));
      }
    });
  }

  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<TicketListResponse>(`/tickets${suffix}`, options);
}

/**
 * Every sidebar and dashboard count in one call.
 *
 * Card 1.69 step 4 grew this from ten to nineteen so the sidebar could stop
 * firing nine uncached `GET /tickets?pageSize=1` requests. `boundaries`
 * carries three dates and nothing else - the endpoint deliberately refuses
 * anything that selects tickets, so it cannot be used to count what the caller
 * may not read.
 */
export function fetchTicketCounts(boundaries?: {
  todayFrom: string;
  awaitingUpdatedTo: string;
  resolvedUpdatedFrom: string;
}) {
  const query = boundaries ? `?${new URLSearchParams(boundaries)}` : "";
  return apiFetch<{
    assignedToMe: number;
    triage: number;
    open: number;
    unassigned: number;
    resolved: number;
    resolvedByMe: number;
    createdByMeOpen: number;
    createdByMeResolved: number;
    atRisk: number;
    overdue: number;
    sev1Today: number;
    awaitingReplyOver24h: number;
    resolvedThisWeek: number;
    reopened: number;
    watching: number;
    mentions: number;
    followUpsDueToday: number;
    /** Card 1.70 ②: what the "Breach risk" label is rendered from. */
    atRiskThresholdMinutes: number;
  }>(`/tickets/counts${query}`);
}

export type TicketMetricsResponse = {
  total: number;
  open: number;
  resolved: number;
  byPriority: { SEV1: number; SEV2: number; SEV3: number; SEV4: number };
  byTeam: Array<{ teamId: string | null; total: number }>;
};

export function fetchTicketMetrics() {
  return apiFetch<TicketMetricsResponse>("/tickets/metrics");
}

export function fetchTicketActivity(params?: {
  from?: string;
  to?: string;
  scope?: "assigned";
}) {
  const query = new URLSearchParams();
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.scope) query.set("scope", params.scope);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<{ data: TicketActivityPoint[] }>(
    `/tickets/activity${suffix}`,
  );
}

export function fetchTicketStatusBreakdown(params?: {
  from?: string;
  to?: string;
  scope?: "assigned";
  dateField?: "createdAt" | "updatedAt";
}) {
  const query = new URLSearchParams();
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.scope) query.set("scope", params.scope);
  if (params?.dateField) query.set("dateField", params.dateField);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<{ data: TicketStatusPoint[] }>(
    `/tickets/status-breakdown${suffix}`,
  );
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
  return apiFetch<SavedViewRecord[] | DataEnvelope<SavedViewRecord[]>>(
    "/saved-views",
  ).then((response) => unwrapDataEnvelope(response));
}

/**
 * The built-in sidebar presets this caller's team has switched off (card 1.53).
 *
 * Ids only. They are code constants, so an id whose preset no longer exists is
 * ignored by `visiblePresets` rather than cleaned up here.
 */
export function fetchHiddenPresets(options?: { signal?: AbortSignal }) {
  return apiFetch<{ data: string[] }>("/saved-views/hidden-presets", {
    signal: options?.signal,
  });
}

/** Replace a team's hidden-preset list. Team admins and owners only. */
export function setHiddenPresets(teamId: string, presetIds: string[]) {
  return apiFetch<{ data: string[] }>(
    `/saved-views/hidden-presets/${teamId}`,
    { method: "PUT", body: JSON.stringify({ presetIds }) },
  );
}

export function createSavedView(payload: {
  name: string;
  filters: Record<string, unknown>;
  isDefault?: boolean;
  teamId?: string;
}) {
  return apiFetch<SavedViewRecord>("/saved-views", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSavedView(
  id: string,
  payload: {
    name?: string;
    filters?: Record<string, unknown>;
    isDefault?: boolean;
    /** Promote to the team, or `null` to make it personal again (card 1.53). */
    teamId?: string | null;
  },
) {
  return apiFetch<SavedViewRecord>(`/saved-views/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteSavedView(id: string) {
  return apiFetch<{ deleted: boolean }>(`/saved-views/${id}`, {
    method: "DELETE",
  });
}

export type CannedResponseRecord = {
  id: string;
  name: string;
  content: string;
  /** What applying this template does, beyond pasting its text (card 1.7). */
  actions?: MacroAction[];
  /**
   * May THIS person edit or delete it (card 1.7b)?
   *
   * Decided by the server, from the same rule its write routes enforce - the
   * author, a lead or admin of the owning team, or an OWNER. Deliberately not
   * re-derived here: card 1.7 had just finished deleting a duplicated rule from
   * this file, and a second copy of the permission would be the same mistake.
   */
  canWrite?: boolean;
  /**
   * Is the caller the AUTHOR, as opposed to a lead maintaining their team's
   * copy? Only the author may change who a template is shared with.
   */
  isMine?: boolean;
  userId: string | null;
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * One macro action, as the server stores it (card 1.7).
 *
 * The same shape the automation rules use - deliberately, so a macro and a rule
 * cannot drift into two action formats. The server refuses to save or run
 * anything outside its allowlist, so `send_email` and the two notify actions
 * never arrive here.
 */
export type MacroAction = {
  type: string;
  status?: string;
  priority?: string;
  tags?: string[];
  categoryId?: string;
  teamId?: string;
  userId?: string;
  target?: string;
  body?: string;
};

/**
 * What a macro WOULD say and do on this ticket, without doing any of it.
 *
 * Card 1.7's "show before you act". The substitution happens on the SERVER -
 * this file used to carry its own copy in CannedResponsePicker, with different
 * key names, and it was the copy whose output an agent sent to a requester.
 */
export type MacroPreview = {
  id: string;
  name: string;
  content: string;
  actions: MacroAction[];
  skippedActions: string[];
};

export function renderCannedResponse(id: string, ticketId: string) {
  return apiFetch<MacroPreview>(
    `/canned-responses/${id}/render?ticketId=${encodeURIComponent(ticketId)}`,
    { method: "POST" },
  );
}

/** Runs the actions. The message itself is still sent by the composer. */
export function applyCannedResponse(id: string, ticketId: string) {
  return apiFetch<{
    content: string;
    applied: number;
    skippedActions: string[];
  }>(`/canned-responses/${id}/apply?ticketId=${encodeURIComponent(ticketId)}`, {
    method: "POST",
  });
}

/**
 * The templates this person can use, plus the one team they may share with.
 *
 * `team` is null when they are on no team, and the editor then offers only
 * "private" - anything else is a 400 since card 1.7b.
 */
export type CannedResponseList = {
  data: CannedResponseRecord[];
  team: { id: string; name: string } | null;
};

export function fetchCannedResponses() {
  return apiFetch<CannedResponseList | CannedResponseRecord[]>(
    "/canned-responses",
  ).then((response) =>
    Array.isArray(response)
      ? { data: response, team: null }
      : { data: response.data ?? [], team: response.team ?? null },
  );
}

export function createCannedResponse(payload: {
  name: string;
  content: string;
  teamId?: string;
  actions?: MacroAction[];
}) {
  return apiFetch<CannedResponseRecord>("/canned-responses", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCannedResponse(
  id: string,
  payload: {
    name?: string;
    content?: string;
    actions?: MacroAction[];
    /**
     * A team id shares it, `null` makes it private, omitting it leaves the
     * sharing alone. Only the author may change this - the server refuses
     * anyone else, including a lead who may otherwise edit the template.
     */
    teamId?: string | null;
  },
) {
  return apiFetch<CannedResponseRecord>(`/canned-responses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCannedResponse(id: string) {
  return apiFetch<{ deleted: boolean }>(`/canned-responses/${id}`, {
    method: "DELETE",
  });
}

export function fetchCustomFields(params?: {
  teamId?: string;
  categoryId?: string;
}) {
  const query = new URLSearchParams();
  if (params?.teamId) query.set("teamId", params.teamId);
  if (params?.categoryId) query.set("categoryId", params.categoryId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
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
  return apiFetch<CustomFieldRecord>("/custom-fields", {
    method: "POST",
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
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCustomField(id: string) {
  return apiFetch<{ deleted: boolean }>(`/custom-fields/${id}`, {
    method: "DELETE",
  });
}

export function setTicketCustomValues(
  ticketId: string,
  values: { customFieldId: string; value?: string | null }[],
) {
  return apiFetch<CustomFieldValueRecord[]>(
    `/custom-fields/tickets/${ticketId}/values`,
    {
      method: "PATCH",
      body: JSON.stringify({ values }),
    },
  );
}

export function fetchTicketById(id: string) {
  return apiFetch<TicketDetail>(`/tickets/${id}`);
}

export function fetchTicketMessages(
  id: string,
  params?: { cursor?: string; take?: number },
) {
  const query = new URLSearchParams();
  if (params?.cursor) query.set("cursor", params.cursor);
  if (params?.take) query.set("take", String(params.take));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<TicketMessagePage>(`/tickets/${id}/messages${suffix}`);
}

export function fetchTicketEvents(
  id: string,
  params?: { cursor?: string; take?: number },
) {
  const query = new URLSearchParams();
  if (params?.cursor) query.set("cursor", params.cursor);
  if (params?.take) query.set("take", String(params.take));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<TicketEventPage>(`/tickets/${id}/events${suffix}`);
}

/** Who a message would reach, as the compose screen shows it (card 1.28). */
export type MessageAudience = {
  to: { id: string; name: string } | null;
  cc: { id: string; name: string; removable: boolean }[];
  refused: { address: string; reason: string }[];
  emails: boolean;
};

/**
 * Ask who a message of `type` would reach.
 *
 * `no-store` deliberately: the audience changes the moment someone is
 * unfollowed, and the 15s hot GET cache would otherwise keep showing a person
 * who has just been removed - the same cache that defeated card 1.26's
 * reconnect refetch.
 */
export function fetchMessageAudience(
  id: string,
  type: "PUBLIC" | "INTERNAL",
) {
  return apiFetch<MessageAudience>(
    `/tickets/${id}/message-recipients?type=${type}`,
    { cache: "no-store" },
  );
}

/**
 * Tell the server this ticket is open in front of us (card 1.9).
 *
 * Best-effort presence: a failure here must never surface to the agent, who is
 * only reading a ticket.
 */
export function setTicketViewing(id: string, isViewing: boolean) {
  return apiFetch<{ ok: boolean }>(`/tickets/${id}/viewing`, {
    method: "POST",
    body: JSON.stringify({ isViewing }),
  });
}

export function fetchTicketFollowers(id: string) {
  return apiFetch<{ data: TicketFollower[] }>(`/tickets/${id}/followers`);
}

export function followTicket(id: string, userId?: string) {
  return apiFetch<{ data: TicketFollower[] }>(`/tickets/${id}/followers`, {
    method: "POST",
    body: JSON.stringify(userId ? { userId } : {}),
  });
}

export function unfollowTicket(id: string, userId: string = "me") {
  return apiFetch<{ id: string }>(`/tickets/${id}/followers/${userId}`, {
    method: "DELETE",
  });
}

export function linkTicket(
  id: string,
  toTicketId: string,
  type: TicketLinkType,
) {
  return apiFetch<{ data: TicketLinkRecord[] }>(`/tickets/${id}/links`, {
    method: "POST",
    body: JSON.stringify({ toTicketId, type }),
  });
}

export function unlinkTicket(id: string, linkId: string) {
  return apiFetch<{ id: string }>(`/tickets/${id}/links/${linkId}`, {
    method: "DELETE",
  });
}

export function createTicket(payload: CreateTicketPayload) {
  return apiFetch<TicketRecord>("/tickets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function addTicketMessage(ticketId: string, payload: AddMessagePayload) {
  return apiFetch<TicketMessage>(`/tickets/${ticketId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function sendTicketTypingSignal(
  ticketId: string,
  payload: { isTyping: boolean },
) {
  return apiFetch<{ ok: boolean }>(`/tickets/${ticketId}/typing`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadTicketAttachment(ticketId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetchWithTimeout(
    `${API_BASE}/tickets/${ticketId}/attachments`,
    {
      method: "POST",
      headers: {
        ...authHeaders(),
      },
      body: form,
    },
  );

  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { message?: string | string[] };
      if (Array.isArray(parsed.message)) {
        message = parsed.message.join(", ");
      } else if (typeof parsed.message === "string") {
        message = parsed.message;
      }
    } catch {
      // keep raw response text
    }
    throw new Error(message || "Attachment upload failed");
  }

  const attachment = (await response.json()) as Attachment;
  invalidateApiCacheByPath("/tickets");
  return attachment;
}

export async function downloadAttachment(attachmentId: string) {
  const response = await fetchWithTimeout(`${API_BASE}/attachments/${attachmentId}`, {
    headers: {
      ...authHeaders(),
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { message?: string | string[] };
      if (Array.isArray(parsed.message)) {
        message = parsed.message.join(", ");
      } else if (typeof parsed.message === "string") {
        message = parsed.message;
      }
    } catch {
      // keep raw response text
    }
    throw new Error(message || "Attachment download failed");
  }

  const blob = await response.blob();
  return blob;
}

export function assignTicket(ticketId: string, payload: AssignPayload) {
  return apiFetch<TicketRecord>(`/tickets/${ticketId}/assign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function transitionTicket(ticketId: string, payload: TransitionPayload) {
  return apiFetch<TicketRecord>(`/tickets/${ticketId}/transition`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function transferTicket(ticketId: string, payload: TransferPayload) {
  return apiFetch<TicketRecord>(`/tickets/${ticketId}/transfer`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Soft-delete a ticket (OWNER, or TEAM_ADMIN of the assigned team). */
export function deleteTicket(ticketId: string, reason?: string) {
  return apiFetch<{ id: string; deletedAt: string }>(`/tickets/${ticketId}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

/** Restore a soft-deleted ticket (OWNER only). */
export function restoreTicket(ticketId: string) {
  return apiFetch<{ id: string; deletedAt: null }>(
    `/tickets/${ticketId}/restore`,
    { method: "POST" },
  );
}

export function setTicketCategory(
  ticketId: string,
  categoryId: string | null,
) {
  return apiFetch<TicketRecord>(`/tickets/${ticketId}/category`, {
    method: "POST",
    body: JSON.stringify({ categoryId }),
  });
}

/** Edit a ticket's subject and/or description (PATCH). Returns the full detail. */
export function updateTicket(
  ticketId: string,
  // followUpAt: card 1.10's "remind me Friday". Null clears it.
  payload: {
    subject?: string;
    description?: string;
    followUpAt?: string | null;
  },
) {
  return apiFetch<TicketDetail>(`/tickets/${ticketId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchTeams(options?: Pick<RequestInit, "signal">) {
  return apiFetch<{ data: TeamRef[] }>("/teams", options);
}

/** Owner-only: includes deactivated teams (for management/reactivation). */
export function fetchAllTeamsAdmin() {
  return apiFetch<{ data: TeamRef[] }>("/teams?includeInactive=true");
}

export function createTeam(payload: {
  name: string;
  description?: string;
  assignmentStrategy?: string;
}) {
  return apiFetch<TeamRef>("/teams", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

type FetchUsersParams = {
  role?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  status?: "active" | "inactive" | "all";
};

export function fetchUsers(
  params?: FetchUsersParams,
  options?: Pick<RequestInit, "signal">,
) {
  const query = new URLSearchParams();
  if (params?.role) query.set("role", params.role);
  if (params?.q) query.set("q", params.q);
  if (params?.page) query.set("page", String(params.page));
  if (params?.pageSize) query.set("pageSize", String(params.pageSize));
  if (params?.status) query.set("status", params.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<{ data: UserRef[]; meta: PaginationMeta }>(
    `/users${suffix}`,
    options,
  );
}

export function previewUserDeactivation(userId: string) {
  return apiFetch<{
    email: string;
    displayName: string;
    isActive: boolean;
    ticketsOpen: number;
    teams: string[];
  }>(`/users/${userId}/deactivation-preview`);
}

export function deactivateUser(userId: string) {
  return apiFetch<{ ok: true; ticketsUnassigned: number; teamsRemoved: number }>(
    `/users/${userId}/deactivate`,
    { method: "POST" },
  );
}

export function reactivateUser(userId: string) {
  return apiFetch<{ ok: true }>(`/users/${userId}/reactivate`, {
    method: "POST",
  });
}

export function fetchCurrentUser() {
  return apiFetch<{ data: CurrentUserSession }>("/auth/me");
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
  }>("/auth/profile", {
    method: "PATCH",
    body: JSON.stringify({ graphProfile }),
  });
}

// ─── Tags ────────────────────────────────────────────────────────────

export type TagRef = {
  id: string;
  name: string;
  color: string | null;
  source?: "AI" | "MANUAL";
};

export type TagAutocompleteEntry = {
  id: string;
  name: string;
  color: string | null;
  ticketCount: number;
};

export type AdminTagEntry = {
  id: string;
  name: string;
  color: string | null;
  ticketCount: number;
  lastUsedAt: string | null;
  createdAt: string;
};

export function fetchTagAutocomplete(q?: string, limit = 20) {
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  query.set("limit", String(limit));
  return apiFetch<TagAutocompleteEntry[]>(`/tags?${query.toString()}`);
}

export function fetchAdminTags() {
  return apiFetch<AdminTagEntry[]>("/admin/tags");
}

export function createTagStandalone(name: string) {
  return apiFetch<TagRef>("/admin/tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function addTagToTicket(ticketId: string, name: string) {
  return apiFetch<TagRef>(`/tickets/${ticketId}/tags`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function removeTagFromTicket(ticketId: string, tagId: string) {
  return apiFetch<{ ok: true }>(
    `/tickets/${ticketId}/tags/${tagId}`,
    { method: "DELETE" },
  );
}

export function renameTag(tagId: string, name: string) {
  return apiFetch<TagRef>(`/admin/tags/${tagId}/rename`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function mergeTags(fromIds: string[], intoId: string) {
  return apiFetch<{ ok: true; movedRows: number; deletedTags: number }>(
    `/admin/tags/merge`,
    {
      method: "POST",
      body: JSON.stringify({ fromIds, intoId }),
    },
  );
}

export function deleteTag(tagId: string) {
  return apiFetch<{ ok: true }>(`/admin/tags/${tagId}`, { method: "DELETE" });
}

export type TagAnalytics = {
  topTags: Array<{ name: string; count: number }>;
  mttrByTag: Array<{ name: string; medianHours: number; sampleSize: number }>;
  perTeam: Array<{
    teamName: string;
    tags: Array<{ name: string; count: number }>;
  }>;
};

export function fetchTagAnalytics(days = 30) {
  return apiFetch<TagAnalytics>(`/reports/tag-analytics?days=${days}`);
}

// ─── Agents Admin ────────────────────────────────────────────────────

export type AgentListRow = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
  primaryTeamName: string | null;
  openCount: number;
  resolvedCount: number;
  medianResolutionHours: number | null;
  lastActivityAt: string | null;
};

export type AgentProfile = {
  user: {
    id: string;
    displayName: string;
    email: string;
    role: string;
    department: string | null;
    location: string | null;
    isActive: boolean;
    deactivatedAt: string | null;
    primaryTeamName: string | null;
    teamMemberships: Array<{ teamId: string; teamName: string; role: string }>;
  };
  counts: { open: number; resolved: number; reopened: number };
  bySev: Record<"SEV1" | "SEV2" | "SEV3" | "SEV4", { open: number; resolved: number }>;
  timings: {
    medianResolutionHours: number | null;
    medianFirstResponseHours: number | null;
    slaCompliancePct: number | null;
    slaSampleSize: number;
    lastActivityAt: string | null;
  };
  dailyResolved: Array<{ date: string; count: number }>;
  recentTickets: Array<{
    id: string;
    displayId: string | null;
    number: number;
    subject: string;
    status: string;
    priority: string;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
  }>;
  topTags: Array<{ name: string; count: number }>;
};

export function fetchAgentsList() {
  return apiFetch<AgentListRow[]>("/admin/agents");
}

export function fetchAgentProfile(userId: string) {
  return apiFetch<AgentProfile>(`/admin/agents/${userId}`);
}

export async function fetchAllUsers(
  params?: Omit<FetchUsersParams, "page">,
  options?: Pick<RequestInit, "signal">,
) {
  const pageSize = Math.min(Math.max(params?.pageSize ?? 100, 1), 100);
  let page = 1;
  let totalPages = 1;
  const users: UserRef[] = [];

  while (page <= totalPages) {
    const response = await fetchUsers(
      {
        ...params,
        page,
        pageSize,
      },
      options,
    );
    users.push(...response.data);
    totalPages = response.meta.totalPages;
    page += 1;
  }

  return { data: users };
}

export function fetchCategories(params?: {
  includeInactive?: boolean;
  q?: string;
  parentId?: string;
}) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        query.append(key, String(value));
      }
    });
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<{ data: CategoryRef[] }>(`/categories${suffix}`);
}

export function createCategory(payload: {
  name: string;
  slug?: string;
  description?: string;
  parentId?: string;
  isActive?: boolean;
}) {
  return apiFetch<CategoryRef>("/categories", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCategory(
  id: string,
  payload: Partial<Omit<CategoryRef, "id" | "parent">>,
) {
  return apiFetch<CategoryRef>(`/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCategory(id: string) {
  return apiFetch<{ id: string }>(`/categories/${id}`, {
    method: "DELETE",
  });
}

// ─── Knowledge Base ─────────────────────────────────────────────────────────
export type KbArticleStatus = "DRAFT" | "PUBLISHED";

export type KbCategoryRef = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  _count?: { articles: number };
};

export type KbArticleSummary = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  status: KbArticleStatus;
  isInternal: boolean;
  viewCount: number;
  categoryId: string | null;
  createdAt: string;
  updatedAt: string;
  category?: { id: string; name: string; slug: string } | null;
  author?: { id: string; displayName: string; email: string } | null;
};

export type KbArticleDetail = KbArticleSummary & {
  content: string;
  related?: Array<{
    id: string;
    title: string;
    slug: string;
    summary: string | null;
  }>;
};

export function fetchKbArticles(params?: {
  q?: string;
  categoryId?: string;
  status?: KbArticleStatus;
  includeDrafts?: boolean;
}) {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<{ data: KbArticleSummary[] }>(`/kb/articles${suffix}`);
}

export function fetchKbArticle(slug: string) {
  return apiFetch<KbArticleDetail>(`/kb/articles/${encodeURIComponent(slug)}`);
}

export function createKbArticle(payload: {
  title: string;
  content: string;
  summary?: string;
  slug?: string;
  status?: KbArticleStatus;
  isInternal?: boolean;
  categoryId?: string;
}) {
  return apiFetch<KbArticleSummary>("/kb/articles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateKbArticle(
  id: string,
  payload: {
    title?: string;
    content?: string;
    summary?: string | null;
    slug?: string;
    status?: KbArticleStatus;
    isInternal?: boolean;
    categoryId?: string | null;
  },
) {
  return apiFetch<KbArticleSummary>(`/kb/articles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteKbArticle(id: string) {
  return apiFetch<{ id: string }>(`/kb/articles/${id}`, { method: "DELETE" });
}

export function fetchKbCategories(params?: { includeInactive?: boolean }) {
  const query = new URLSearchParams();
  if (params?.includeInactive) query.set("includeInactive", "true");
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<{ data: KbCategoryRef[] }>(`/kb/categories${suffix}`);
}

export function createKbCategory(payload: {
  name: string;
  slug?: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  return apiFetch<KbCategoryRef>("/kb/categories", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateKbCategory(
  id: string,
  payload: {
    name?: string;
    slug?: string;
    description?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  return apiFetch<KbCategoryRef>(`/kb/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteKbCategory(id: string) {
  return apiFetch<{ id: string }>(`/kb/categories/${id}`, { method: "DELETE" });
}

export function fetchTeamMembers(teamId: string) {
  return apiFetch<{ data: TeamMember[] }>(`/teams/${teamId}/members`);
}

export function addTeamMember(
  teamId: string,
  payload: { userId: string; role?: string },
) {
  return apiFetch<TeamMember>(`/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTeam(
  teamId: string,
  payload: {
    name?: string;
    slug?: string;
    description?: string;
    isActive?: boolean;
    assignmentStrategy?: string;
  },
) {
  return apiFetch<TeamRef>(`/teams/${teamId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateTeamMember(
  teamId: string,
  memberId: string,
  payload: { role: string },
) {
  return apiFetch<TeamMember>(`/teams/${teamId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function removeTeamMember(teamId: string, memberId: string) {
  return apiFetch<{ id: string }>(`/teams/${teamId}/members/${memberId}`, {
    method: "DELETE",
  });
}

export function setUserPrimaryTeam(userId: string, primaryTeamId: string | null) {
  return apiFetch<{ id: string; primaryTeamId: string | null; role: string }>(
    `/users/${userId}/primary-team`,
    {
      method: "PATCH",
      body: JSON.stringify({ primaryTeamId }),
    },
  );
}

export function updateUserRole(
  userId: string,
  payload: { role: string; primaryTeamId?: string | null },
) {
  return apiFetch<{ id: string; role: string; primaryTeamId: string | null }>(
    `/users/${userId}/role`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function fetchRoutingRules() {
  return apiFetch<{ data: RoutingRule[] }>("/routing-rules");
}

export function fetchSlaPolicies(teamId: string) {
  return apiFetch<{ data: SlaPolicy[] }>(`/slas?teamId=${teamId}`);
}

export function updateSlaPolicies(
  teamId: string,
  policies: Array<Omit<SlaPolicy, "source">>,
) {
  return apiFetch<{ data: SlaPolicy[] }>(`/slas/${teamId}`, {
    method: "PUT",
    body: JSON.stringify({ policies }),
  });
}

export function resetSlaPolicies(teamId: string) {
  return apiFetch<{ data: SlaPolicy[] }>(`/slas/${teamId}`, {
    method: "DELETE",
  });
}

export function fetchSlaPolicyConfigs() {
  return apiFetch<{ data: SlaPolicyConfigRecord[] }>("/slas/policies");
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
  return apiFetch<{ data: SlaPolicyConfigRecord }>("/slas/policies", {
    method: "POST",
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
  return apiFetch<{ data: SlaPolicyConfigRecord }>(
    `/slas/policies/${policyId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteSlaPolicyConfig(policyId: string) {
  return apiFetch<{ id: string }>(`/slas/policies/${policyId}`, {
    method: "DELETE",
  });
}

export function fetchSlaBusinessHoursSettings() {
  return apiFetch<{ data: SlaBusinessHoursSettings }>("/slas/settings");
}

export function updateSlaBusinessHoursSettings(payload: {
  timezone?: string;
  schedule?: SlaBusinessDayRecord[];
  holidays?: SlaHolidayRecord[];
}) {
  return apiFetch<{ data: SlaBusinessHoursSettings }>("/slas/settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function createRoutingRule(payload: {
  name: string;
  keywords?: string[];
  teamId?: string;
  assigneeId?: string;
  priority?: number;
  isActive?: boolean;
  matchType?: RoutingMatchType;
  conditions?: RoutingCondition[];
  actions?: RoutingActionItem[];
}) {
  return apiFetch<RoutingRule>("/routing-rules", {
    method: "POST",
    body: JSON.stringify(payload),
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
    matchType?: RoutingMatchType;
    conditions?: RoutingCondition[];
    actions?: RoutingActionItem[];
  },
) {
  return apiFetch<RoutingRule>(`/routing-rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteRoutingRule(id: string) {
  return apiFetch<{ id: string }>(`/routing-rules/${id}`, {
    method: "DELETE",
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
  priority?: TicketPriority | string;
  status?: TicketStatus | string;
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
  return apiFetch<{ data: AutomationRule[] }>("/automation-rules");
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
  return apiFetch<AutomationRule>("/automation-rules", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAutomationRule(
  id: string,
  payload: Partial<
    Omit<
      AutomationRule,
      "id" | "team" | "createdBy" | "createdAt" | "updatedAt"
    >
  >,
) {
  return apiFetch<AutomationRule>(`/automation-rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteAutomationRule(id: string) {
  return apiFetch<{ id: string }>(`/automation-rules/${id}`, {
    method: "DELETE",
  });
}

export function testAutomationRule(ruleId: string, ticketId: string) {
  return apiFetch<{
    matched: boolean;
    actionsThatWouldRun: AutomationAction[];
    message: string;
  }>(`/automation-rules/${ruleId}/test`, {
    method: "POST",
    body: JSON.stringify({ ticketId }),
  });
}

export function fetchAutomationRuleExecutions(
  ruleId: string,
  page = 1,
  pageSize = 20,
) {
  return apiFetch<{
    data: Array<{
      id: string;
      ruleId: string;
      ticketId: string;
      success: boolean;
      error?: string | null;
      executedAt: string;
      ticket?: {
        id: string;
        number: number;
        displayId: string | null;
        subject: string;
      };
    }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }>(
    `/automation-rules/${ruleId}/executions?page=${page}&pageSize=${pageSize}`,
  );
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

async function getCachedUsers(signal?: AbortSignal): Promise<UserRef[]> {
  validateCacheUser();
  const now = Date.now();
  if (cachedUsers && now - usersCacheTime < CACHE_TTL_MS) {
    return cachedUsers;
  }
  try {
    const response = await fetchAllUsers(undefined, { signal });
    cachedUsers = response.data;
    usersCacheTime = now;
    return cachedUsers;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    // Return cached data if available, empty array otherwise
    return cachedUsers ?? [];
  }
}

async function getCachedTeams(signal?: AbortSignal): Promise<TeamRef[]> {
  validateCacheUser();
  const now = Date.now();
  if (cachedTeams && now - teamsCacheTime < CACHE_TTL_MS) {
    return cachedTeams;
  }
  try {
    const response = await fetchTeams({ signal });
    cachedTeams = response.data;
    teamsCacheTime = now;
    return cachedTeams;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    // Return cached data if available, empty array otherwise
    return cachedTeams ?? [];
  }
}

export async function searchAll(
  query: string,
  signal?: AbortSignal,
): Promise<SearchResults> {
  // Check if aborted before starting
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Perform parallel searches across tickets, users (cached), and teams (cached)
  const [ticketsResponse, users, teams] = await Promise.all([
    fetchTickets({ q: query, pageSize: 5 }, { signal }).catch((error) => {
      if (isAbortError(error)) {
        throw error;
      }
      return { data: [] };
    }),
    getCachedUsers(signal),
    getCachedTeams(signal),
  ]);

  // Check if aborted after fetching
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Filter users and teams client-side based on query
  const loweredQuery = query.toLowerCase();

  const filteredUsers = users
    .filter(
      (user) =>
        user.displayName.toLowerCase().includes(loweredQuery) ||
        user.email.toLowerCase().includes(loweredQuery),
    )
    .slice(0, 5);

  const filteredTeams = teams
    .filter((team) => team.name.toLowerCase().includes(loweredQuery))
    .slice(0, 5);

  return {
    tickets: ticketsResponse.data.map((t) => ({
      id: t.id,
      number: t.number,
      displayId: t.displayId,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      assignedTeam: t.assignedTeam,
    })),
    users: filteredUsers,
    teams: filteredTeams,
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

const NOTIFICATION_FETCH_OPTIONS = { cache: "no-store" } as const;

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
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<NotificationListResponse>(
    `/notifications${suffix}`,
    NOTIFICATION_FETCH_OPTIONS,
  );
}

export function fetchUnreadNotificationCount() {
  return apiFetch<{ count: number } | DataEnvelope<{ count: number }>>(
    "/notifications/unread-count",
    NOTIFICATION_FETCH_OPTIONS,
  ).then((response) => unwrapDataEnvelope(response));
}

export function markNotificationAsRead(notificationId: string) {
  return apiFetch<{ success: boolean } | DataEnvelope<{ success: boolean }>>(
    `/notifications/${notificationId}/read`,
    {
      method: "PATCH",
    },
  ).then((response) => unwrapDataEnvelope(response));
}

export function markAllNotificationsAsRead() {
  return apiFetch<
    | { success: boolean; count: number }
    | DataEnvelope<{ success: boolean; count: number }>
  >("/notifications/read-all", {
    method: "PATCH",
  }).then((response) => unwrapDataEnvelope(response));
}

export type RealtimeNegotiation = {
  enabled: boolean;
  hub: string | null;
  url: string | null;
  groups: string[];
};

export function negotiateRealtimeConnection() {
  return apiFetch<DataEnvelope<RealtimeNegotiation>>(
    "/realtime/negotiate",
  ).then((response) => unwrapDataEnvelope(response));
}

// ============================================
// Bulk ticket actions
// ============================================

export type BulkResult = {
  success: number;
  failed: number;
  succeededTicketIds: string[];
  failedTicketIds: string[];
  errors: Array<{ ticketId: string; message: string }>;
};

export function bulkAssignTickets(ticketIds: string[], assigneeId?: string) {
  return apiFetch<BulkResult | DataEnvelope<BulkResult>>(
    "/tickets/bulk/assign",
    {
      method: "POST",
      body: JSON.stringify({ ticketIds, assigneeId }),
    },
  ).then((response) => unwrapDataEnvelope(response));
}

export function bulkTransferTickets(
  ticketIds: string[],
  newTeamId: string,
  assigneeId?: string,
) {
  return apiFetch<BulkResult | DataEnvelope<BulkResult>>(
    "/tickets/bulk/transfer",
    {
      method: "POST",
      body: JSON.stringify({ ticketIds, newTeamId, assigneeId }),
    },
  ).then((response) => unwrapDataEnvelope(response));
}

export function bulkStatusTickets(ticketIds: string[], status: string) {
  return apiFetch<BulkResult | DataEnvelope<BulkResult>>(
    "/tickets/bulk/status",
    {
      method: "POST",
      body: JSON.stringify({ ticketIds, status }),
    },
  ).then((response) => unwrapDataEnvelope(response));
}

/**
 * Card 1.12. `add` and `remove` are tag NAMES, matching the single-ticket
 * endpoint - an agent tagging twenty tickets is thinking "vpn", not a uuid.
 */
export function bulkTagTickets(
  ticketIds: string[],
  add: string[],
  remove: string[],
) {
  return apiFetch<BulkResult | DataEnvelope<BulkResult>>("/tickets/bulk/tags", {
    method: "POST",
    body: JSON.stringify({ ticketIds, add, remove }),
  }).then((response) => unwrapDataEnvelope(response));
}

/**
 * Card 1.12. Runs the macro's ACTIONS only - its text is never sent. There is
 * no composer for twenty tickets, and the composer is the only path that
 * enforces the reply rules.
 */
export function bulkMacroTickets(
  ticketIds: string[],
  cannedResponseId: string,
) {
  return apiFetch<BulkResult | DataEnvelope<BulkResult>>(
    "/tickets/bulk/macro",
    {
      method: "POST",
      body: JSON.stringify({ ticketIds, cannedResponseId }),
    },
  ).then((response) => unwrapDataEnvelope(response));
}

/**
 * Card 1.11. Removes a message's content. DELETE because the message is gone
 * from the reader's point of view; the row stays so the conversation keeps its
 * shape. The original text is not preserved anywhere.
 */
export function redactTicketMessage(ticketId: string, messageId: string) {
  return apiFetch<{
    id: string;
    redactedAt: string;
    redactedBy: string;
    alreadyEmailed: boolean;
    /** Card 1.47. How many people a send that got away reached. */
    emailedCount?: number;
    /** Card 1.47. How many queued emails this removal actually stopped. */
    emailsStopped?: number;
    /** Card 1.48. How many pasted-in images went with the message. */
    inlineAttachmentsRemoved?: number;
  }>(`/tickets/${ticketId}/messages/${messageId}`, { method: "DELETE" });
}

export function bulkPriorityTickets(ticketIds: string[], priority: string) {
  return apiFetch<BulkResult | DataEnvelope<BulkResult>>(
    "/tickets/bulk/priority",
    {
      method: "POST",
      body: JSON.stringify({ ticketIds, priority }),
    },
  ).then((response) => unwrapDataEnvelope(response));
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
  groupBy?: "team" | "priority";
  scope?: "assigned";
  dateField?: "createdAt" | "updatedAt";
  statusGroup?: "open" | "resolved" | "all";
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

export type SlaComplianceByTeamResponse = {
  data: Array<{
    teamId: string;
    teamName: string;
    met: number;
    breached: number;
    total: number;
    compliance: number;
    firstResponseMet: number;
    firstResponseBreached: number;
    resolutionMet: number;
    resolutionBreached: number;
  }>;
};
export type ResolutionTimeResponse = {
  data: { label: string; id?: string; avgHours: number; count: number }[];
};
export type TicketsByStatusResponse = {
  data: { status: string; count: number }[];
};
export type TicketsByPriorityResponse = {
  data: { priority: string; count: number }[];
};
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
/** Card 1.17. A single object of totals, not a series. */
export type FirstContactResolutionResponse = {
  resolved: number;
  firstContact: number;
  percent: number;
};
/** Card 1.17. `reassignments: 0` is the healthy case, not missing data. */
export type ReassignmentCountResponse = {
  data: { reassignments: number; tickets: number }[];
  tickets: number;
  averagePerTicket: number;
};
/** Card 1.17. `intervals` is how many closed intervals each average rests on. */
export type TimeInStatusResponse = {
  data: {
    status: string;
    averageHours: number;
    medianHours: number;
    intervals: number;
  }[];
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
  data: {
    id: string;
    name: string;
    open: number;
    resolved: number;
    total: number;
  }[];
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
    if (v === undefined || v === "") return;
    if (Array.isArray(v)) {
      if (v.length > 0) q.set(k, v.join(","));
      return;
    }
    q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function fetchReportTicketVolume(params: ReportQuery) {
  return apiFetch<TicketVolumeResponse>(
    `/reports/ticket-volume${reportQueryString(params)}`,
  );
}
export function fetchReportSummary(params: ReportQuery) {
  // Server defaults resolutionTime.groupBy to "team" for the summary response.
  return apiFetch<ReportSummaryResponse>(
    `/reports/summary${reportQueryString(params)}`,
  );
}
export function fetchReportSlaCompliance(params: ReportQuery) {
  return apiFetch<SlaComplianceResponse>(
    `/reports/sla-compliance${reportQueryString(params)}`,
  );
}
export function fetchReportSlaComplianceByPriority(params: ReportQuery) {
  return apiFetch<SlaComplianceByPriorityResponse>(
    `/reports/sla-compliance-by-priority${reportQueryString(params)}`,
  );
}
export function fetchReportSlaComplianceByTeam(params: ReportQuery) {
  return apiFetch<SlaComplianceByTeamResponse>(
    `/reports/sla-compliance-by-team${reportQueryString(params)}`,
  );
}
export function fetchReportResolutionTime(params: ReportQuery) {
  return apiFetch<ResolutionTimeResponse>(
    `/reports/resolution-time${reportQueryString(params)}`,
  );
}
export function fetchReportTicketsByStatus(params: ReportQuery) {
  return apiFetch<TicketsByStatusResponse>(
    `/reports/tickets-by-status${reportQueryString(params)}`,
  );
}
export function fetchReportTicketsByPriority(params: ReportQuery) {
  return apiFetch<TicketsByPriorityResponse>(
    `/reports/tickets-by-priority${reportQueryString(params)}`,
  );
}
export function fetchReportAgentPerformance(params: ReportQuery) {
  return apiFetch<AgentPerformanceResponse>(
    `/reports/agent-performance${reportQueryString(params)}`,
  );
}
export function fetchReportAgentWorkload(params: ReportQuery) {
  return apiFetch<AgentWorkloadResponse>(
    `/reports/agent-workload${reportQueryString(params)}`,
  );
}
export function fetchReportTicketsByAge(params: ReportQuery) {
  return apiFetch<TicketAgeBucketResponse>(
    `/reports/tickets-by-age${reportQueryString(params)}`,
  );
}
export function fetchReportReopenRate(params: ReportQuery) {
  return apiFetch<ReopenRateResponse>(
    `/reports/reopen-rate${reportQueryString(params)}`,
  );
}
export function fetchReportFirstContactResolution(params: ReportQuery) {
  return apiFetch<FirstContactResolutionResponse>(
    `/reports/first-contact-resolution${reportQueryString(params)}`,
  );
}
export function fetchReportReassignmentCount(params: ReportQuery) {
  return apiFetch<ReassignmentCountResponse>(
    `/reports/reassignment-count${reportQueryString(params)}`,
  );
}
export function fetchReportTimeInStatus(params: ReportQuery) {
  return apiFetch<TimeInStatusResponse>(
    `/reports/time-in-status${reportQueryString(params)}`,
  );
}
export function fetchReportCsatTrend(params: ReportQuery) {
  return apiFetch<CsatTrendResponse>(
    `/reports/csat-trend${reportQueryString(params)}`,
  );
}
export function fetchReportCsatDrivers(params: ReportQuery) {
  return apiFetch<CsatDriversResponse>(
    `/reports/csat-drivers${reportQueryString(params)}`,
  );
}
export function fetchReportCsatLowTags(params: ReportQuery) {
  return apiFetch<CsatLowTagsResponse>(
    `/reports/csat-low-tags${reportQueryString(params)}`,
  );
}
export function fetchReportSlaBreaches(params: ReportQuery) {
  return apiFetch<SlaBreachesResponse>(
    `/reports/sla-breaches${reportQueryString(params)}`,
  );
}
export function fetchReportChannelBreakdown(params: ReportQuery) {
  return apiFetch<ChannelBreakdownResponse>(
    `/reports/channel-breakdown${reportQueryString(params)}`,
  );
}
export function fetchReportTicketsByCategory(params: ReportQuery) {
  return apiFetch<TicketsByCategoryResponse>(
    `/reports/tickets-by-category${reportQueryString(params)}`,
  );
}
export function fetchReportTeamSummary(params: ReportQuery) {
  return apiFetch<TeamSummaryResponse>(
    `/reports/team-summary${reportQueryString(params)}`,
  );
}
export function fetchReportTransfers(params: ReportQuery) {
  return apiFetch<TransfersResponse>(
    `/reports/transfers${reportQueryString(params)}`,
  );
}

// ——— Audit Log ———
export type AuditLogCategory =
  | "tickets"
  | "routing"
  | "sla"
  | "automation"
  | "custom_fields"
  | "ai";

export type AuditLogEntry = {
  id: string;
  ticketId: string;
  ticketNumber: number;
  ticketDisplayId: string | null;
  type: string;
  category: AuditLogCategory;
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
  category?: AuditLogCategory;
  page?: number;
  pageSize?: number;
};

export type AuditLogCategoryCounts = {
  tickets: number;
  sla: number;
  routing: number;
  automation: number;
  custom_fields: number;
  ai: number;
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
      if (value === undefined || value === "") return;
      query.set(key, String(value));
    });
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<AuditLogResponse>(`/audit-log${suffix}`);
}

export async function fetchAuditLogExport(
  params?: Omit<AuditLogParams, "page" | "pageSize">,
): Promise<string> {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === "") return;
      query.set(key, String(value));
    });
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetchWithTimeout(`${API_BASE}/audit-log/export${suffix}`, {
    headers: { ...authHeaders() },
  });
  if (!response.ok) {
    const raw = await response.text();
    const message = formatApiErrorMessage(raw, "Export failed");
    throw new ApiError(message, response.status);
  }
  return response.text();
}

/**
 * The filtered ticket list as CSV (card 1.13). Takes the very same params the
 * list query uses, so the download is what is on screen.
 */
export async function exportTicketsCsv(
  params?: Record<string, string | number | boolean | undefined | string[]>,
): Promise<string> {
  const query = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === "") return;
      if (Array.isArray(value)) {
        if (value.length) query.set(key, value.join(","));
      } else {
        query.set(key, String(value));
      }
    });
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetchWithTimeout(
    `${API_BASE}/tickets/export.csv${suffix}`,
    { headers: { ...authHeaders() } },
  );
  if (!response.ok) {
    const raw = await response.text();
    throw new ApiError(
      formatApiErrorMessage(raw, "Export failed"),
      response.status,
    );
  }
  return response.text();
}

/** One table-shaped report as CSV, scoped exactly like the report itself. */
export async function exportReportCsv(
  report: string,
  params: ReportQuery,
): Promise<string> {
  const response = await fetchWithTimeout(
    `${API_BASE}/reports/${report}/export.csv${reportQueryString(params)}`,
    { headers: { ...authHeaders() } },
  );
  if (!response.ok) {
    const raw = await response.text();
    throw new ApiError(
      formatApiErrorMessage(raw, "Export failed"),
      response.status,
    );
  }
  return response.text();
}

// ─── Operations console (card 1.21) ─────────────────────────────────────────

export type OperationsSwitch = {
  key: string;
  label: string;
  description: string;
  on: boolean;
  state: string;
  setting: string | null;
};

export type OperationsDataIn = {
  key: string;
  label: string;
  path: string;
  configured: boolean;
  state: string;
};

export type OperationsJobRow = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  intervalMs: number | null;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastSummary: Record<string, unknown> | null;
  nextRunAt: string | null;
};

/** Email outbox depth (card 1.32). Numbers only - no address, no subject. */
export type OperationsOutboxCounts = {
  pending: number;
  processing: number;
  sent: number;
  failed: number;
};

export type OperationsSnapshot = {
  generatedAt: string;
  switches: OperationsSwitch[] | null;
  dataIn: OperationsDataIn[] | null;
  jobs: OperationsJobRow[];
  outbox: OperationsOutboxCounts | null;
};

export type OperationsJobRunResult = {
  key: string;
  ran: boolean;
  skipped: "locked" | null;
  summary: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

/** Everything the Operations page needs, in one owner-only call. */
export function fetchOperationsSnapshot() {
  return apiFetch<OperationsSnapshot>("/operations");
}

/** Run one background job now. Owner only; a locked job answers skipped: "locked". */
export function runOperationsJob(key: string) {
  return apiFetch<OperationsJobRunResult>(`/operations/jobs/${key}/run`, {
    method: "POST",
  });
}

// ─── AI Classification ──────────────────────────────────────────────────────

export interface AiPipelineStep {
  step: number;
  name: string;
  agentName: string;
  input: string;
  rawOutput: string;
  parsed: unknown;
  toolsCalled: string[];
  latencyMs: number;
  status: "success" | "error";
  error?: string;
}

export interface AiSuggestedArticle {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
}

export interface AiClassifyResultCreated {
  status: "created";
  suggestedArticles?: AiSuggestedArticle[];
  ticket: {
    id: string;
    number: number;
    displayId: string | null;
    subject: string;
    description: string;
    status: string;
    priority: string;
    channel: string;
    requesterId: string;
    assignedTeamId: string | null;
    categoryId: string | null;
  };
  aiAnalysis?: {
    what: string;
    who: string;
    context: string;
    urgency: string;
    intent: string;
    requestType: string;
    department: string;
    departmentConfidence: number;
    category: string | null;
    reasoning: string;
  };
  aiMetadata: {
    intentConfidence: number;
    classificationConfidence: number;
    overallConfidence: number;
    reasoning: string;
    pipelineLatencyMs: number;
    modelUsed: string;
  };
}

export interface AiClassifyResultClarification {
  status: "needs_clarification";
  question: string;
  partialClassification: Record<string, unknown>;
  suggestedArticles?: AiSuggestedArticle[];
}

export interface AiClassifyResultError {
  status: "error";
  error: string;
  step: string;
}

export type AiClassifyResult =
  | AiClassifyResultCreated
  | AiClassifyResultClarification
  | AiClassifyResultError;

export interface AiDebugResult {
  steps: AiPipelineStep[];
  finalStatus: "created" | "needs_clarification" | "error";
  totalLatencyMs: number;
  ticket?: Record<string, unknown>;
  clarifyingQuestion?: string;
  errorMessage?: string;
}

export async function classifyTicket(payload: {
  text: string;
  userId?: string;
  channel?: string;
}): Promise<AiClassifyResult> {
  return apiFetch("/ai/classify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function debugPipeline(payload: {
  text: string;
  userId?: string;
  createTicket?: boolean;
}): Promise<AiDebugResult> {
  return apiFetch("/ai/debug", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchAiAnalysis(
  ticketId: string,
): Promise<{ data: Record<string, unknown> | null }> {
  return apiFetch(`/ai/analysis/${ticketId}`);
}

// ─── CSAT (Customer Satisfaction) ───────────────────────────────────────────

export interface CsatPayload {
  ticketId: string;
  rating: number;
  comment?: string;
}

export interface CsatRecord {
  id: string;
  payload: { rating: number; comment?: string | null };
  createdAt: string;
}

export async function submitCsat(payload: CsatPayload): Promise<CsatRecord> {
  return apiFetch("/csat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchCsat(
  ticketId: string,
): Promise<{ data: CsatRecord | null }> {
  return apiFetch(`/csat/${ticketId}`);
}
