import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BarChart3,
  ClipboardList,
  Clock,
  BookOpen,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Settings,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { ErrorBoundary, RouteErrorFallback } from "./components/ErrorBoundary";
import {
  fetchTeams,
  type CurrentUserSession,
  type TeamRef,
} from "./api/client";
import { CommandPalette } from "./components/CommandPalette";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";
import { AdminSidebar } from "./components/AdminSidebar";
import { SignInLandingPage } from "./components/auth/SignInLandingPage";
import { Sidebar, type SidebarItem } from "./components/Sidebar";
import {
  SidebarTeams,
  SidebarTicketsSavedViews,
} from "./components/SidebarSavedViews";
import { ToastContainer } from "./components/ToastContainer";
import { TopBar } from "./components/TopBar";
import { TicketTabsProvider } from "./contexts/TicketTabsContext";
import {
  HeaderProvider,
  type HeaderContextValue,
} from "./contexts/HeaderContext";
import { useCommandPalette } from "./hooks/useCommandPalette";
import { useCreateTicketForm } from "./hooks/useCreateTicketForm";
import { useAuthSession } from "./hooks/useAuthSession";
import { useTheme } from "./hooks/useTheme";
import { shouldEnableNotificationPolling } from "./hooks/notification-fallback";
import {
  getShortcutContext,
  useKeyboardShortcuts,
} from "./hooks/useKeyboardShortcuts";
import { useNotifications } from "./hooks/useNotifications";
import { useRealtimeEvents } from "./hooks/useRealtimeEvents";
import {
  REALTIME_TICKET_CHANGED_EVENT,
  type RealtimeTicketChangedEventPayload,
  REALTIME_TICKET_TYPING_EVENT,
  type RealtimeTicketTypingEventPayload,
} from "./realtime/events";
import { guardRoute } from "./route-access";
import { getSidebarBadge, getSidebarChildBadge } from "./sidebar-badges";
import { useSidebarState } from "./hooks/useSidebarState";
import { useToast } from "./hooks/useToast";
import { useTicketCountsQuery } from "./hooks/useTicketCountsQuery";
import { useTicketDataInvalidation } from "./contexts/TicketDataInvalidationContext";
import { PageSkeleton } from "./components/skeletons";
import type { Role, StatusFilter, TicketScope } from "./types";
import { NewTicketPage } from "./pages/NewTicketPage";
import { NewRoutingRulePage } from "./pages/NewRoutingRulePage";
import { NewAutomationRulePage } from "./pages/NewAutomationRulePage";
import { NewCustomFieldPage } from "./pages/NewCustomFieldPage";
import { NewCategoryPage } from "./pages/NewCategoryPage";

// Lazy-loaded page components for code splitting – each page is a separate chunk
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const ManagerViewsPage = lazy(() =>
  import("./pages/ManagerViewsPage").then((m) => ({
    default: m.ManagerViewsPage,
  })),
);
const SlaSettingsPage = lazy(() =>
  import("./pages/SlaSettingsPage").then((m) => ({
    default: m.SlaSettingsPage,
  })),
);
const ReportsPage = lazy(() =>
  import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const AuditLogPage = lazy(() =>
  import("./pages/AuditLogPage").then((m) => ({ default: m.AuditLogPage })),
);
const AutomationRulesPage = lazy(() =>
  import("./pages/AutomationRulesPage").then((m) => ({
    default: m.AutomationRulesPage,
  })),
);
const NotFoundPage = lazy(() =>
  import("./pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })),
);
const RoutingRulesPage = lazy(() =>
  import("./pages/RoutingRulesPage").then((m) => ({
    default: m.RoutingRulesPage,
  })),
);
const CategoriesPage = lazy(() =>
  import("./pages/CategoriesPage").then((m) => ({ default: m.CategoriesPage })),
);
const AdminTagsPage = lazy(() =>
  import("./pages/AdminTagsPage").then((m) => ({ default: m.AdminTagsPage })),
);
const AgentsDirectoryPage = lazy(() =>
  import("./pages/AgentsDirectoryPage").then((m) => ({
    default: m.AgentsDirectoryPage,
  })),
);
const AgentProfilePage = lazy(() =>
  import("./pages/AgentProfilePage").then((m) => ({
    default: m.AgentProfilePage,
  })),
);
const KbAdminPage = lazy(() =>
  import("./pages/KbAdminPage").then((m) => ({ default: m.KbAdminPage })),
);
const KbBrowsePage = lazy(() =>
  import("./pages/KbBrowsePage").then((m) => ({ default: m.KbBrowsePage })),
);
const KbArticleEditorPage = lazy(() =>
  import("./pages/KbArticleEditorPage").then((m) => ({
    default: m.KbArticleEditorPage,
  })),
);
const KbArticlePage = lazy(() =>
  import("./pages/KbArticlePage").then((m) => ({ default: m.KbArticlePage })),
);
const CustomFieldsAdminPage = lazy(() =>
  import("./pages/CustomFieldsAdminPage").then((m) => ({
    default: m.CustomFieldsAdminPage,
  })),
);
const TeamPage = lazy(() =>
  import("./pages/TeamPage").then((m) => ({ default: m.TeamPage })),
);
const TicketDetailPage = lazy(() =>
  import("./pages/TicketDetailPage").then((m) => ({
    default: m.TicketDetailPage,
  })),
);
const TicketsPage = lazy(() =>
  import("./pages/TicketsPage").then((m) => ({ default: m.TicketsPage })),
);
const TriageBoardPage = lazy(() =>
  import("./pages/TriageBoardPage").then((m) => ({
    default: m.TriageBoardPage,
  })),
);
const AiSubmitPage = lazy(() =>
  import("./pages/AiSubmitPage").then((m) => ({ default: m.AiSubmitPage })),
);
const AiDebugPage = lazy(() =>
  import("./pages/AiDebugPage").then((m) => ({ default: m.AiDebugPage })),
);
const TicketsPageRevamp = lazy(() =>
  import("./pages/TicketsPageRevamp"),
);
const TicketDetailRevamp = lazy(() =>
  import("./pages/TicketDetailRevamp"),
);

function PageFallback() {
  return (
    <div className="flex-1 w-full animate-pulse" style={{ background: "hsl(var(--background))" }}>
      <PageSkeleton />
    </div>
  );
}

type NavKey =
  | "dashboard"
  | "submit"
  | "help"
  | "tickets"
  | "assigned"
  | "unassigned"
  | "created"
  | "created-open"
  | "created-resolved"
  | "completed"
  | "triage"
  | "manager"
  | "reports"
  | "team"
  | "sla-settings"
  | "admin";

const navItems: (SidebarItem & { roles: Role[] })[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["EMPLOYEE", "AGENT", "LEAD", "TEAM_ADMIN", "OWNER"],
  },
  {
    key: "submit",
    label: "AI Submit",
    icon: Sparkles,
    roles: ["EMPLOYEE", "AGENT", "LEAD", "TEAM_ADMIN", "OWNER"],
  },
  {
    key: "tickets",
    label: "All Tickets",
    icon: Ticket,
    roles: ["AGENT", "LEAD", "TEAM_ADMIN", "OWNER"],
    children: [{ key: "assigned", label: "Assigned to Me", icon: Ticket }],
  },
  {
    key: "created",
    label: "My Tickets",
    icon: FileText,
    roles: ["EMPLOYEE", "AGENT", "LEAD", "TEAM_ADMIN", "OWNER"],
  },
  {
    key: "help",
    label: "Help Center",
    icon: BookOpen,
    roles: ["EMPLOYEE", "AGENT", "LEAD", "TEAM_ADMIN", "OWNER"],
  },
  {
    key: "triage",
    label: "Triage Board",
    icon: ClipboardList,
    roles: ["AGENT", "LEAD", "TEAM_ADMIN", "OWNER"],
  },
  {
    key: "manager",
    label: "Manager Views",
    icon: FolderKanban,
    roles: ["LEAD", "TEAM_ADMIN", "OWNER"],
  },
  {
    key: "reports",
    label: "Reports",
    icon: BarChart3,
    roles: ["LEAD", "TEAM_ADMIN", "OWNER"],
  },
  {
    key: "team",
    label: "Team",
    icon: Users,
    roles: ["LEAD", "TEAM_ADMIN", "OWNER"],
  },
  {
    key: "sla-settings",
    label: "SLA Settings",
    icon: Clock,
    roles: ["LEAD", "TEAM_ADMIN", "OWNER"],
  },
  {
    key: "admin",
    label: "Admin",
    icon: Settings,
    roles: ["TEAM_ADMIN", "OWNER"],
  },
];

function canUseAdminMenu(role: Role): boolean {
  return role === "TEAM_ADMIN" || role === "OWNER";
}

function canAccessReports(role: Role): boolean {
  return role === "LEAD" || role === "TEAM_ADMIN" || role === "OWNER";
}

function isAdminRoutePath(pathname: string): boolean {
  return (
    pathname.startsWith("/ai-debug") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/sla-settings") ||
    pathname.startsWith("/routing") ||
    pathname.startsWith("/automation") ||
    pathname.startsWith("/custom-fields") ||
    pathname.startsWith("/audit-log") ||
    pathname.startsWith("/categories") ||
    pathname.startsWith("/reports")
  );
}

function isShellLayoutPath(pathname: string): boolean {
  if (pathname === "/submit") return true;
  if (pathname === "/ai-debug") return true;
  if (pathname === "/tickets" || pathname.startsWith("/tickets/")) return true;
  if (pathname === "/routing" || pathname.startsWith("/routing/")) return true;
  if (pathname === "/automation" || pathname.startsWith("/automation/"))
    return true;
  if (pathname === "/custom-fields" || pathname.startsWith("/custom-fields/"))
    return true;
  if (pathname === "/categories" || pathname.startsWith("/categories/"))
    return true;
  if (pathname === "/admin/tags") return true;
  if (pathname === "/admin/agents" || pathname.startsWith("/admin/agents/"))
    return true;
  if (pathname === "/admin/kb" || pathname.startsWith("/admin/kb/")) return true;
  if (pathname === "/help" || pathname.startsWith("/help/")) return true;
  return (
    pathname === "/dashboard" ||
    pathname === "/triage" ||
    pathname === "/manager" ||
    pathname === "/team" ||
    pathname === "/sla-settings" ||
    pathname === "/audit-log" ||
    pathname === "/reports"
  );
}

function deriveNavKey(
  pathname: string,
  role: Role,
  ticketPresetStatus: StatusFilter,
  ticketPresetScope: TicketScope,
): NavKey {
  if (pathname === "/submit") return "submit";
  if (pathname.startsWith("/triage")) return "triage";
  if (pathname.startsWith("/manager")) return "manager";
  if (pathname.startsWith("/reports"))
    return canAccessReports(role) ? "reports" : "admin";
  if (pathname.startsWith("/team")) return "team";
  if (pathname.startsWith("/sla-settings"))
    return canUseAdminMenu(role) ? "admin" : "sla-settings";
  if (
    pathname.startsWith("/routing") ||
    pathname.startsWith("/automation") ||
    pathname.startsWith("/audit-log") ||
    pathname.startsWith("/categories") ||
    pathname.startsWith("/custom-fields")
  )
    return "admin";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/tickets")) {
    if (ticketPresetScope === "assigned") return "assigned";
    if (ticketPresetScope === "unassigned") return "unassigned";
    if (ticketPresetScope === "created") {
      if (ticketPresetStatus === "open") return "created-open";
      if (ticketPresetStatus === "resolved") return "created-resolved";
      return "created";
    }
    if (ticketPresetStatus === "resolved") return "completed";
    return role === "EMPLOYEE" ? "created" : "tickets";
  }
  return "dashboard";
}

/* ——— View title / subtitle resolution ——— */

const viewMeta: Record<NavKey, { title: string; subtitle: string }> = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Quick view of your ticket activity and updates.",
  },
  submit: {
    title: "AI Submit",
    subtitle: "Describe your issue and let AI route it.",
  },
  help: {
    title: "Help Center",
    subtitle: "Find answers before you open a ticket.",
  },
  tickets: {
    title: "All Tickets",
    subtitle: "Track, filter, and manage your support requests.",
  },
  assigned: {
    title: "Assigned to Me",
    subtitle: "Tickets waiting for your action.",
  },
  unassigned: {
    title: "Unassigned",
    subtitle: "Tickets waiting to be picked up.",
  },
  created: {
    title: "My Tickets",
    subtitle: "Requests you have opened or own.",
  },
  "created-open": {
    title: "My Tickets — Open",
    subtitle: "Your open requests awaiting resolution.",
  },
  "created-resolved": {
    title: "My Tickets — Resolved",
    subtitle: "Your requests that have been resolved or closed.",
  },
  completed: { title: "Completed", subtitle: "Closed and resolved tickets." },
  triage: {
    title: "Triage Board",
    subtitle: "Monitor open tickets by status.",
  },
  manager: {
    title: "Manager Views",
    subtitle: "High-level ticket volume and workload insights.",
  },
  reports: {
    title: "Reports",
    subtitle: "Analytics and insights for helpdesk operations.",
  },
  team: { title: "Team", subtitle: "Manage members and roles." },
  "sla-settings": {
    title: "SLA Settings",
    subtitle: "Configure SLA targets per department.",
  },
  admin: { title: "Admin", subtitle: "Configuration and settings." },
};

const routeTitleOverrides: {
  prefix: string;
  title: string;
  subtitle?: string;
}[] = [
  {
    prefix: "/routing",
    title: "Routing Rules",
    subtitle: "Manage keyword-based routing logic.",
  },
  {
    prefix: "/automation",
    title: "Automation Rules",
    subtitle:
      "Run actions when tickets are created, status changes, or SLA is at risk.",
  },
  {
    prefix: "/audit-log",
    title: "Audit Log",
    subtitle: "Ticket changes and actions for compliance and troubleshooting.",
  },
  {
    prefix: "/categories",
    title: "Categories",
    subtitle: "Organize ticket categories and subcategories.",
  },
  {
    prefix: "/custom-fields",
    title: "Custom Fields",
    subtitle: "Define custom fields per team for tickets.",
  },
  {
    prefix: "/reports",
    title: "Reports",
    subtitle: "Analytics and insights for helpdesk operations.",
  },
  {
    prefix: "/admin/tags",
    title: "Tags",
    subtitle: "Rename, merge, or delete ticket tags.",
  },
  {
    prefix: "/admin/agents",
    title: "Agents",
    subtitle: "Agent performance and per-person analytics.",
  },
];

function resolveViewTitle(
  pathname: string,
  navKey: NavKey,
  role: Role,
): { title: string; subtitle: string } {
  const override = routeTitleOverrides.find((r) =>
    pathname.startsWith(r.prefix),
  );
  if (override) {
    return {
      title: override.title,
      subtitle: override.subtitle ?? viewMeta[navKey]?.subtitle ?? "",
    };
  }
  const meta = viewMeta[navKey];
  const title = meta?.title ?? "Dashboard";
  let subtitle =
    meta?.subtitle ?? "Quick view of your ticket activity and updates.";
  if (navKey === "created" && role !== "EMPLOYEE") {
    subtitle = "Requests you have opened or own.";
  }
  return { title, subtitle };
}

/* ——— Authenticated shell ——— */

function AuthenticatedShell({
  user,
  onSignOut,
  theme,
  onToggleTheme,
}: {
  user: CurrentUserSession;
  onSignOut: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  // Extracted hooks (6.1)
  const currentEmail = user.email;
  const currentPersona = useMemo(
    () => ({ role: user.role as Role }),
    [user.role],
  );
  const sidebar = useSidebarState();
  const { notifyTicketAggregatesChanged, notifyTicketReportsChanged } =
    useTicketDataInvalidation();

  const createTicketForm = useCreateTicketForm({
    onSuccess: () => {
      notifyTicketAggregatesChanged();
      notifyTicketReportsChanged();
    },
    toastSuccess: toast.success,
    toastError: toast.error,
  });

  const [teamsList, setTeamsList] = useState<TeamRef[]>([]);
  const { data: ticketCounts } = useTicketCountsQuery(currentEmail);

  const [navKey, setNavKey] = useState<NavKey>("dashboard");
  const [ticketPresetStatus, setTicketPresetStatus] =
    useState<StatusFilter>("open");
  const [ticketPresetScope, setTicketPresetScope] =
    useState<TicketScope>("all");
  const [notificationsRealtimeAvailable, setNotificationsRealtimeAvailable] =
    useState(false);

  // Command Palette
  const commandPalette = useCommandPalette({
    onCreateTicket: createTicketForm.openModal,
  });

  // Notifications
  const notifications = useNotifications({
    pollingInterval: 30000,
    enablePolling: shouldEnableNotificationPolling(
      notificationsRealtimeAvailable,
    ),
    userKey: currentEmail,
    onActionError: toast.error,
  });
  const handleRealtimeTicketChange = useCallback(
    (payload: RealtimeTicketChangedEventPayload) => {
      window.dispatchEvent(
        new CustomEvent<RealtimeTicketChangedEventPayload>(
          REALTIME_TICKET_CHANGED_EVENT,
          {
            detail: payload,
          },
        ),
      );

      // Pages now apply ticket deltas directly from realtime payloads, so we only
      // refresh lightweight shared aggregates (e.g. sidebar counts).
      if (payload.reason !== "message_added") {
        notifyTicketAggregatesChanged();
      }
    },
    [notifyTicketAggregatesChanged],
  );
  const handleRealtimeNotificationsUpdated = useCallback(
    (payload?: { reason?: string; unreadCount?: number }) => {
      notifications.applyRealtimeUpdate(payload);
      // Mentions sidebar count depends on unread TICKET_MENTIONED
      // notifications, so a new mention or a read flip should refresh
      // saved-view counts immediately. Watching list also needs to
      // respect status changes that come in via the same realtime path.
      notifyTicketAggregatesChanged();
    },
    [notifications.applyRealtimeUpdate, notifyTicketAggregatesChanged],
  );
  const handleRealtimeTicketTyping = useCallback(
    (payload: RealtimeTicketTypingEventPayload) => {
      window.dispatchEvent(
        new CustomEvent<RealtimeTicketTypingEventPayload>(
          REALTIME_TICKET_TYPING_EVENT,
          {
            detail: payload,
          },
        ),
      );
    },
    [],
  );

  useRealtimeEvents({
    enabled: true,
    userKey: currentEmail,
    onTicketChanged: handleRealtimeTicketChange,
    onTicketTyping: handleRealtimeTicketTyping,
    onNotificationsUpdated: handleRealtimeNotificationsUpdated,
    onAvailabilityChange: setNotificationsRealtimeAvailable,
  });

  // Keyboard shortcuts
  const keyboardShortcuts = useKeyboardShortcuts();
  const shortcutContext = getShortcutContext(location.pathname);

  const adminMenuEnabled = canUseAdminMenu(currentPersona.role);
  const isAdminRoute = isAdminRoutePath(location.pathname);
  const showAdminSidebar =
    adminMenuEnabled && isAdminRoute && !sidebar.adminSidebarDismissed;
  const shellLayoutPath = isShellLayoutPath(location.pathname);
  const desktopMainOffset = showAdminSidebar
    ? "lg:ml-[248px]"
    : sidebar.isSidebarCollapsed
      ? "lg:ml-[64px]"
      : "lg:ml-[220px]";
  const showMobileBackdrop =
    sidebar.isMobileViewport &&
    (sidebar.mobileSidebarOpen || sidebar.mobileAdminSidebarOpen);

  /* ——— Derived state ——— */

  useEffect(() => {
    setNavKey(
      deriveNavKey(
        location.pathname,
        currentPersona.role,
        ticketPresetStatus,
        ticketPresetScope,
      ),
    );
  }, [
    location.pathname,
    currentPersona.role,
    ticketPresetStatus,
    ticketPresetScope,
  ]);

  useEffect(() => {
    if (!isAdminRoute) sidebar.setAdminSidebarDismissed(false);
  }, [isAdminRoute, sidebar.setAdminSidebarDismissed]);

  const refreshTeams = useCallback(() => {
    return fetchTeams()
      .then((response) => setTeamsList(response.data))
      .catch(() => setTeamsList([]));
  }, []);

  useEffect(() => {
    refreshTeams();
  }, [currentEmail, refreshTeams]);

  /* ——— Navigation handler (memoized, 6.3) ——— */

  const handleNavSelect = useCallback(
    (key: NavKey) => {
      sidebar.setMobileSidebarOpen(false);
      sidebar.setMobileAdminSidebarOpen(false);

      switch (key) {
        case "dashboard":
          navigate("/dashboard");
          return;
        case "submit":
          navigate("/submit");
          return;
        case "help":
          navigate("/help");
          return;
        case "triage":
          navigate("/triage");
          return;
        case "manager":
          navigate("/manager");
          return;
        case "reports":
          navigate("/reports");
          return;
        case "team":
          navigate("/team");
          return;
        case "sla-settings":
          navigate("/sla-settings");
          return;
        case "admin":
          sidebar.setAdminSidebarDismissed(false);
          navigate("/sla-settings");
          if (sidebar.isMobileViewport) sidebar.setMobileAdminSidebarOpen(true);
          return;
        case "completed":
          setTicketPresetStatus("resolved");
          setTicketPresetScope("all");
          navigate("/tickets?statusGroup=resolved");
          return;
        case "assigned":
          setTicketPresetStatus("open");
          setTicketPresetScope("assigned");
          navigate("/tickets?scope=assigned&statusGroup=open");
          return;
        case "unassigned":
          setTicketPresetStatus("open");
          setTicketPresetScope("unassigned");
          navigate("/tickets?scope=unassigned&statusGroup=open");
          return;
        case "created":
          setTicketPresetStatus("all");
          setTicketPresetScope("created");
          navigate("/tickets?scope=created");
          return;
        case "created-open":
          setTicketPresetStatus("open");
          setTicketPresetScope("created");
          navigate("/tickets?scope=created&statusGroup=open");
          return;
        case "created-resolved":
          setTicketPresetStatus("resolved");
          setTicketPresetScope("created");
          navigate("/tickets?scope=created&statusGroup=resolved");
          return;
        case "tickets":
          setTicketPresetStatus("open");
          setTicketPresetScope("all");
          navigate("/tickets?statusGroup=open");
          return;
        default:
          navigate("/dashboard");
      }
    },
    [navigate, sidebar],
  );

  /* ——— Sidebar nav items (memoized, 6.3) ——— */

  const visibleNav = useMemo(() => {
    const filtered = navItems
      .filter((item) => item.roles.includes(currentPersona.role))
      .filter((item) => !(adminMenuEnabled && item.key === "sla-settings"));
    return filtered.map((item) => ({
      key: item.key,
      label: item.label,
      icon: item.icon,
      badge: getSidebarBadge(item.key, ticketCounts),
      children: item.children?.map((child) => ({
        key: child.key,
        label: child.label,
        icon: child.icon,
        badge: getSidebarChildBadge(child.key, ticketCounts),
      })),
      extraChildren:
        item.key === "tickets" ? (
          <SidebarTicketsSavedViews theme={theme} />
        ) : undefined,
    }));
  }, [adminMenuEnabled, currentPersona.role, ticketCounts, theme]);

  /* ——— Header context value (6.2 – eliminates prop drilling) ——— */

  const { title: viewTitle, subtitle: viewSubtitle } = resolveViewTitle(
    location.pathname,
    navKey,
    currentPersona.role,
  );

  const openMobileNavigation = useCallback(() => {
    if (adminMenuEnabled && isAdminRoute && !sidebar.adminSidebarDismissed) {
      sidebar.setMobileAdminSidebarOpen(true);
      sidebar.setMobileSidebarOpen(false);
      return;
    }
    sidebar.setMobileSidebarOpen(true);
    sidebar.setMobileAdminSidebarOpen(false);
  }, [adminMenuEnabled, isAdminRoute, sidebar]);

  const headerValue: HeaderContextValue = useMemo(
    () => ({
      title: viewTitle,
      subtitle: viewSubtitle,
      currentEmail,
      onOpenNavigation: openMobileNavigation,
      onOpenSearch: commandPalette.open,
      currentUser: user,
      onSignOut,
      notificationProps: {
        notifications: notifications.notifications,
        unreadCount: notifications.unreadCount,
        loading: notifications.loading,
        actionError: notifications.actionError,
        hasMore: notifications.hasMore,
        onLoadMore: notifications.loadMore,
        // Wrap mark-as-read so the sidebar Mentions count refreshes
        // immediately — without this it'd wait for the next realtime
        // notifications.changed event.
        onMarkAsRead: async (id: string) => {
          await notifications.markAsRead(id);
          notifyTicketAggregatesChanged();
        },
        onMarkAllAsRead: async () => {
          await notifications.markAllAsRead();
          notifyTicketAggregatesChanged();
        },
        onRefresh: notifications.refresh,
      },
      theme,
      onToggleTheme,
    }),
    [
      viewTitle,
      viewSubtitle,
      currentEmail,
      openMobileNavigation,
      commandPalette.open,
      user,
      onSignOut,
      notifications.notifications,
      notifications.unreadCount,
      notifications.loading,
      notifications.actionError,
      notifications.hasMore,
      notifications.loadMore,
      notifications.markAsRead,
      notifications.markAllAsRead,
      notifications.refresh,
      theme,
      onToggleTheme,
    ],
  );

  const isLeadOrAbove =
    currentPersona.role === "LEAD" ||
    currentPersona.role === "TEAM_ADMIN" ||
    currentPersona.role === "OWNER";
  const canViewTriage = isLeadOrAbove || currentPersona.role === "AGENT";
  const canViewReports = canAccessReports(currentPersona.role);
  const isAdminOrOwner =
    currentPersona.role === "TEAM_ADMIN" || currentPersona.role === "OWNER";

  // UI revamp preview: render the new design bare (no legacy chrome).
  if (location.pathname.startsWith("/tickets-revamp")) {
    const detailMatch = location.pathname.match(/^\/tickets-revamp\/([^/]+)/);
    return (
      <>
        <ToastContainer />
        <Suspense fallback={<PageFallback />}>
          {detailMatch ? <TicketDetailRevamp /> : <TicketsPageRevamp />}
        </Suspense>
      </>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden">
      <ToastContainer />
      <div className="flex">
        {/* Mobile backdrop */}
        {showMobileBackdrop && (
          <button
            type="button"
            onClick={() => {
              sidebar.setMobileSidebarOpen(false);
              sidebar.setMobileAdminSidebarOpen(false);
            }}
            className="fixed inset-0 z-40 bg-slate-900/35 lg:hidden"
            aria-label="Close navigation"
          />
        )}

        {/* Unified Sidebar (Desktop & Mobile) */}
        <Sidebar
          collapsed={
            sidebar.isMobileViewport ? false : sidebar.isSidebarCollapsed
          }
          hideCollapseToggle={sidebar.isMobileViewport}
          onToggle={() => {
            if (sidebar.isMobileViewport) {
              sidebar.setMobileSidebarOpen(false);
            } else {
              sidebar.setIsSidebarCollapsed((prev) => !prev);
            }
          }}
          items={visibleNav}
          activeKey={navKey}
          onSelect={(key) => handleNavSelect(key as NavKey)}
          currentRole={currentPersona.role}
          onCreateTicket={() => {
            if (sidebar.isMobileViewport) sidebar.setMobileSidebarOpen(false);
            navigate("/tickets/new");
          }}
          className={`z-50 transition-transform ${
            sidebar.isMobileViewport
              ? sidebar.mobileSidebarOpen
                ? "translate-x-0"
                : "-translate-x-full pointer-events-none"
              : "translate-x-0 lg:flex"
          } ${sidebar.isMobileViewport ? "lg:hidden" : "hidden lg:flex z-40"}`}
          showAdminSidebarTrigger={
            adminMenuEnabled &&
            (sidebar.isMobileViewport
              ? !sidebar.mobileAdminSidebarOpen
              : !showAdminSidebar)
          }
          onOpenAdminSidebar={() => {
            sidebar.setAdminSidebarDismissed(false);
            if (sidebar.isMobileViewport) {
              sidebar.setMobileSidebarOpen(false);
              sidebar.setMobileAdminSidebarOpen(true);
            }
            if (!isAdminRoutePath(location.pathname)) navigate("/sla-settings");
          }}
          theme={theme}
          onToggleTheme={onToggleTheme}
          extraNavContent={
            isLeadOrAbove ? (
              <SidebarTeams
                collapsed={
                  sidebar.isMobileViewport ? false : sidebar.isSidebarCollapsed
                }
                theme={theme}
              />
            ) : null
          }
        />

        {/* Unified Admin Sidebar (Desktop & Mobile) */}
        {adminMenuEnabled && (
          <AdminSidebar
            visible={
              sidebar.isMobileViewport
                ? sidebar.mobileAdminSidebarOpen
                : showAdminSidebar
            }
            role={currentPersona.role}
            pathname={location.pathname}
            onBack={() => {
              if (sidebar.isMobileViewport) {
                sidebar.setMobileAdminSidebarOpen(false);
                sidebar.setMobileSidebarOpen(true);
              } else {
                sidebar.setAdminSidebarDismissed(true);
              }
            }}
            onNavigate={(route) => {
              sidebar.setAdminSidebarDismissed(false);
              if (sidebar.isMobileViewport) {
                sidebar.setMobileAdminSidebarOpen(false);
                sidebar.setMobileSidebarOpen(false);
              }
              navigate(route);
            }}
            className={
              sidebar.isMobileViewport ? "z-[60] lg:hidden" : "hidden lg:block"
            }
            theme={theme}
          />
        )}

        <main
          className={`flex-1 min-w-0 h-screen overflow-y-auto ${shellLayoutPath ? "py-0" : "py-8"} ${desktopMainOffset}`}
          style={{ transition: "margin-left 300ms cubic-bezier(0.4, 0, 0.2, 1)" }}
        >
          {!shellLayoutPath && (
            <TopBar
              title={viewTitle}
              subtitle={viewSubtitle}
              currentEmail={currentEmail}
              onOpenNavigation={openMobileNavigation}
              onOpenSearch={commandPalette.open}
              notificationProps={headerValue.notificationProps}
              user={user}
              onSignOut={onSignOut}
              theme={theme}
              onToggleTheme={onToggleTheme}
            />
          )}

          {/* HeaderProvider eliminates headerProps prop drilling (6.2) */}
          <TicketTabsProvider>
          <HeaderProvider value={headerValue}>
            {/* Route-level error boundary (2.2 fix) – resets automatically on navigation
                because the key changes with the pathname. */}
            <ErrorBoundary
              key={location.pathname}
              fallback={(props) => <RouteErrorFallback {...props} />}
            >
              <Suspense fallback={<PageFallback />}>
                <div key={location.pathname} className="animate-fade-in">
                  <Routes>
                    <Route
                      path="/"
                      element={<Navigate to="/dashboard" replace />}
                    />
                    <Route
                      path="/dashboard"
                      element={<DashboardPage role={currentPersona.role} />}
                    />
                    <Route path="/help" element={<KbBrowsePage />} />
                    <Route path="/help/:slug" element={<KbArticlePage />} />
                    <Route
                      path="/admin/kb"
                      element={guardRoute(isAdminOrOwner, <KbAdminPage />)}
                    />
                    <Route
                      path="/admin/kb/new"
                      element={guardRoute(isAdminOrOwner, <KbArticleEditorPage />)}
                    />
                    <Route
                      path="/admin/kb/:slug/edit"
                      element={guardRoute(isAdminOrOwner, <KbArticleEditorPage />)}
                    />
                    <Route
                      path="/triage"
                      element={guardRoute(
                        canViewTriage,
                        (
                          <TriageBoardPage
                            teamsList={teamsList}
                            role={currentPersona.role}
                          />
                        ),
                      )}
                    />
                    <Route
                      path="/manager"
                      element={guardRoute(
                        isLeadOrAbove,
                        <ManagerViewsPage teamsList={teamsList} />,
                      )}
                    />
                    <Route
                      path="/reports"
                      element={guardRoute(
                        canViewReports,
                        <ReportsPage role={currentPersona.role} />,
                      )}
                    />
                    <Route
                      path="/team"
                      element={guardRoute(
                        isLeadOrAbove,
                        (
                          <TeamPage
                            teamsList={teamsList}
                            role={currentPersona.role}
                            onTeamsChanged={refreshTeams}
                          />
                        ),
                      )}
                    />
                    <Route
                      path="/sla-settings"
                      element={guardRoute(
                        isLeadOrAbove,
                        (
                          <SlaSettingsPage
                            teamsList={teamsList}
                            role={currentPersona.role}
                          />
                        ),
                      )}
                    />
                    <Route
                      path="/admin"
                      element={guardRoute(
                        isAdminOrOwner,
                        <Navigate to="/sla-settings" replace />,
                      )}
                    />
                    <Route
                      path="/routing"
                      element={guardRoute(
                        isAdminOrOwner,
                        (
                          <RoutingRulesPage
                            teamsList={teamsList}
                            role={currentPersona.role}
                          />
                        ),
                      )}
                    />
                    <Route
                      path="/routing/new"
                      element={guardRoute(
                        isAdminOrOwner,
                        (
                          <NewRoutingRulePage
                            teamsList={teamsList}
                            role={currentPersona.role}
                          />
                        ),
                      )}
                    />
                    <Route
                      path="/automation"
                      element={guardRoute(
                        isAdminOrOwner,
                        (
                          <AutomationRulesPage
                            role={currentPersona.role}
                            teamsList={teamsList}
                          />
                        ),
                      )}
                    />
                    <Route
                      path="/automation/new"
                      element={guardRoute(
                        isAdminOrOwner,
                        (
                          <NewAutomationRulePage
                            teamsList={teamsList}
                            role={currentPersona.role}
                          />
                        ),
                      )}
                    />
                    <Route
                      path="/audit-log"
                      element={guardRoute(
                        isAdminOrOwner,
                        <AuditLogPage />,
                      )}
                    />
                    <Route
                      path="/categories"
                      element={guardRoute(
                        isAdminOrOwner,
                        <CategoriesPage role={currentPersona.role} />,
                      )}
                    />
                    <Route
                      path="/admin/tags"
                      element={guardRoute(
                        isAdminOrOwner,
                        <AdminTagsPage role={currentPersona.role} />,
                      )}
                    />
                    <Route
                      path="/admin/agents"
                      element={guardRoute(
                        isAdminOrOwner,
                        <AgentsDirectoryPage />,
                      )}
                    />
                    <Route
                      path="/admin/agents/:id"
                      element={guardRoute(
                        isAdminOrOwner,
                        <AgentProfilePage />,
                      )}
                    />
                    <Route
                      path="/categories/new"
                      element={guardRoute(
                        currentPersona.role === "OWNER",
                        <NewCategoryPage />,
                      )}
                    />
                    <Route
                      path="/custom-fields"
                      element={guardRoute(
                        isAdminOrOwner,
                        <CustomFieldsAdminPage role={currentPersona.role} />,
                      )}
                    />
                    <Route
                      path="/custom-fields/new"
                      element={guardRoute(
                        isAdminOrOwner,
                        <NewCustomFieldPage role={currentPersona.role} />,
                      )}
                    />
                    <Route
                      path="/submit"
                      element={<AiSubmitPage />}
                    />
                    <Route
                      path="/ai-debug"
                      element={guardRoute(
                        isAdminOrOwner,
                        <AiDebugPage />,
                      )}
                    />
                    <Route
                      path="/tickets"
                      element={
                        <TicketsPage
                          role={currentPersona.role}
                          currentEmail={currentEmail}
                          presetStatus={ticketPresetStatus}
                          presetScope={ticketPresetScope}
                          teamsList={teamsList}
                          onCreateTicket={() => navigate("/tickets/new")}
                        />
                      }
                    />
                    <Route
                      path="/tickets-revamp"
                      element={<TicketsPageRevamp />}
                    />
                    <Route
                      path="/tickets/new"
                      element={
                        <NewTicketPage
                          role={currentPersona.role}
                          teamsList={teamsList}
                        />
                      }
                    />
                    <Route
                      path="/tickets/:ticketId"
                      element={
                        <TicketDetailPage
                          currentEmail={currentEmail}
                          role={currentPersona.role}
                          teamsList={teamsList}
                        />
                      }
                    />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </div>
              </Suspense>
            </ErrorBoundary>
          </HeaderProvider>
          </TicketTabsProvider>
        </main>
      </div>

      <CommandPalette
        isOpen={commandPalette.isOpen}
        onClose={commandPalette.close}
        recentSearches={commandPalette.recentSearches}
        onSearch={commandPalette.addRecentSearch}
        onClearRecent={commandPalette.clearRecentSearches}
        onCreateTicket={() => navigate("/tickets/new")}
        currentRole={currentPersona.role}
      />

      <KeyboardShortcutsHelp
        open={keyboardShortcuts.showHelp}
        onClose={keyboardShortcuts.closeHelp}
        context={shortcutContext}
      />
    </div>
  );
}

/* ——— Main App component ——— */

function App() {
  const auth = useAuthSession();
  const { theme, toggleTheme } = useTheme();

  if (auth.loading) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center"
        style={{ background: "hsl(var(--background))" }}
      >
        {/* Background glow */}
        <div
          className="pointer-events-none fixed inset-0 overflow-hidden"
          aria-hidden="true"
        >
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full opacity-[0.07] blur-[80px]"
            style={{ background: "hsl(var(--primary))" }}
          />
        </div>

        <div className="relative flex flex-col items-center animate-fade-in">
          <div
            className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl font-bold text-white shadow-glow"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(217 91% 60%) 100%)",
            }}
          >
            <Ticket className="h-7 w-7 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="mb-8 text-xl font-bold tracking-tight text-foreground">
            Ticket
          </h1>
          <div className="flex flex-col items-center gap-3">
            <div
              className="h-5 w-5 animate-spin rounded-full border-[2.5px]"
              style={{
                borderColor: "hsl(var(--border))",
                borderTopColor: "hsl(var(--primary))",
              }}
            />
            <p className="text-sm font-medium text-muted-foreground animate-pulse">
              Authenticating…
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!auth.user) {
    return (
      <SignInLandingPage
        onSignIn={() => {
          void auth.signIn();
        }}
        error={auth.error}
      />
    );
  }

  return <AuthenticatedShell user={auth.user} onSignOut={auth.signOut} theme={theme} onToggleTheme={toggleTheme} />;
}

export default App;
