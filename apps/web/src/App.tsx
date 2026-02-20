import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle,
  ClipboardList,
  Clock,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogIn,
  Menu,
  Settings,
  Ticket,
  Users
} from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary, RouteErrorFallback } from './components/ErrorBoundary';
import { fetchTeams, type CurrentUserSession, type TeamRef } from './api/client';
import { CommandPalette } from './components/CommandPalette';
import { CreateTicketModal } from './components/CreateTicketModal';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import { AdminSidebar } from './components/AdminSidebar';
import { Sidebar, type SidebarItem } from './components/Sidebar';
import { ToastContainer } from './components/ToastContainer';
import { TopBar } from './components/TopBar';
import { HeaderProvider, type HeaderContextValue } from './contexts/HeaderContext';
import { useCommandPalette } from './hooks/useCommandPalette';
import { useCreateTicketForm } from './hooks/useCreateTicketForm';
import { useAuthSession } from './hooks/useAuthSession';
import { getShortcutContext, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useNotifications } from './hooks/useNotifications';
import { useSidebarState } from './hooks/useSidebarState';
import { useToast } from './hooks/useToast';
import { useTicketCountsQuery } from './hooks/useTicketCountsQuery';
import { useTicketDataInvalidation } from './contexts/TicketDataInvalidationContext';
import type { Role, StatusFilter, TicketScope } from './types';

// Lazy-loaded page components for code splitting – each page is a separate chunk
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ManagerViewsPage = lazy(() => import('./pages/ManagerViewsPage').then((m) => ({ default: m.ManagerViewsPage })));
const SlaSettingsPage = lazy(() => import('./pages/SlaSettingsPage').then((m) => ({ default: m.SlaSettingsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const AutomationRulesPage = lazy(() => import('./pages/AutomationRulesPage').then((m) => ({ default: m.AutomationRulesPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const RoutingRulesPage = lazy(() => import('./pages/RoutingRulesPage').then((m) => ({ default: m.RoutingRulesPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const CustomFieldsAdminPage = lazy(() => import('./pages/CustomFieldsAdminPage').then((m) => ({ default: m.CustomFieldsAdminPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then((m) => ({ default: m.TeamPage })));
const TicketDetailPage = lazy(() => import('./pages/TicketDetailPage').then((m) => ({ default: m.TicketDetailPage })));
const TicketsPage = lazy(() => import('./pages/TicketsPage').then((m) => ({ default: m.TicketsPage })));
const TriageBoardPage = lazy(() => import('./pages/TriageBoardPage').then((m) => ({ default: m.TriageBoardPage })));

function PageFallback() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
    </div>
  );
}

function AuthRequiredScreen({
  onSignIn,
  error,
}: {
  onSignIn: () => void;
  error: string | null;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Sign in required</h1>
        <p className="mt-2 text-sm text-slate-600">
          Sign in with your Microsoft account to access the ticketing system.
        </p>
        {error && (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onSignIn}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <LogIn className="h-4 w-4" />
          <span>Sign in with Microsoft</span>
        </button>
      </div>
    </div>
  );
}

type NavKey =
  | 'dashboard'
  | 'tickets'
  | 'assigned'
  | 'unassigned'
  | 'created'
  | 'completed'
  | 'triage'
  | 'manager'
  | 'team'
  | 'sla-settings'
  | 'admin';

const navItems: (SidebarItem & { roles: Role[] })[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['EMPLOYEE', 'AGENT', 'LEAD', 'TEAM_ADMIN', 'OWNER'] },
  {
    key: 'tickets',
    label: 'All Tickets',
    icon: Ticket,
    roles: ['AGENT', 'LEAD', 'TEAM_ADMIN', 'OWNER'],
    children: [
      { key: 'assigned', label: 'Assigned to Me', icon: Ticket },
      { key: 'unassigned', label: 'Unassigned', icon: Ticket },
    ],
  },
  { key: 'created', label: 'Created by Me', icon: FileText, roles: ['EMPLOYEE', 'AGENT', 'LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'completed', label: 'Completed', icon: CheckCircle, roles: ['EMPLOYEE', 'AGENT', 'LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'triage', label: 'Triage Board', icon: ClipboardList, roles: ['LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'manager', label: 'Manager Views', icon: FolderKanban, roles: ['LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'team', label: 'Team', icon: Users, roles: ['LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'sla-settings', label: 'SLA Settings', icon: Clock, roles: ['LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'admin', label: 'Admin', icon: Settings, roles: ['TEAM_ADMIN', 'OWNER'] }
];

function canUseAdminMenu(role: Role): boolean {
  return role === 'TEAM_ADMIN' || role === 'OWNER';
}

function isAdminRoutePath(pathname: string): boolean {
  return (
    pathname.startsWith('/admin') ||
    pathname.startsWith('/sla-settings') ||
    pathname.startsWith('/routing') ||
    pathname.startsWith('/automation') ||
    pathname.startsWith('/custom-fields') ||
    pathname.startsWith('/audit-log') ||
    pathname.startsWith('/categories') ||
    pathname.startsWith('/reports')
  );
}

function isShellLayoutPath(pathname: string): boolean {
  if (pathname === '/tickets' || pathname.startsWith('/tickets/')) return true;
  return (
    pathname === '/dashboard' ||
    pathname === '/triage' ||
    pathname === '/manager' ||
    pathname === '/team' ||
    pathname === '/sla-settings' ||
    pathname === '/routing' ||
    pathname === '/automation' ||
    pathname === '/audit-log' ||
    pathname === '/custom-fields' ||
    pathname === '/categories' ||
    pathname === '/reports'
  );
}

function deriveNavKey(
  pathname: string,
  role: Role,
  ticketPresetStatus: StatusFilter,
  ticketPresetScope: TicketScope
): NavKey {
  if (pathname.startsWith('/triage')) return 'triage';
  if (pathname.startsWith('/manager')) return 'manager';
  if (pathname.startsWith('/team')) return 'team';
  if (pathname.startsWith('/sla-settings')) return canUseAdminMenu(role) ? 'admin' : 'sla-settings';
  if (
    pathname.startsWith('/routing') ||
    pathname.startsWith('/automation') ||
    pathname.startsWith('/audit-log') ||
    pathname.startsWith('/categories') ||
    pathname.startsWith('/custom-fields') ||
    pathname.startsWith('/reports')
  ) return 'admin';
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/tickets')) {
    if (ticketPresetScope === 'assigned') return 'assigned';
    if (ticketPresetScope === 'unassigned') return 'unassigned';
    if (ticketPresetScope === 'created') return 'created';
    if (ticketPresetStatus === 'resolved') return 'completed';
    return role === 'EMPLOYEE' ? 'created' : 'tickets';
  }
  return 'dashboard';
}

/* ——— View title / subtitle resolution ——— */

const viewMeta: Record<NavKey, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Quick view of your ticket activity and updates.' },
  tickets: { title: 'All Tickets', subtitle: 'Track, filter, and manage your support requests.' },
  assigned: { title: 'Assigned to Me', subtitle: 'Tickets waiting for your action.' },
  unassigned: { title: 'Unassigned', subtitle: 'Tickets waiting to be picked up.' },
  created: { title: 'My Tickets', subtitle: 'Requests you have opened or own.' },
  completed: { title: 'Completed', subtitle: 'Closed and resolved tickets.' },
  triage: { title: 'Triage Board', subtitle: 'Monitor open tickets by status.' },
  manager: { title: 'Manager Views', subtitle: 'High-level ticket volume and workload insights.' },
  team: { title: 'Team', subtitle: 'Manage members and roles.' },
  'sla-settings': { title: 'SLA Settings', subtitle: 'Configure SLA targets per department.' },
  admin: { title: 'Admin', subtitle: 'Configuration and settings.' },
};

const routeTitleOverrides: { prefix: string; title: string; subtitle?: string }[] = [
  { prefix: '/routing', title: 'Routing Rules', subtitle: 'Manage keyword-based routing logic.' },
  { prefix: '/automation', title: 'Automation Rules', subtitle: 'Run actions when tickets are created, status changes, or SLA is at risk.' },
  { prefix: '/audit-log', title: 'Audit Log', subtitle: 'Ticket changes and actions for compliance and troubleshooting.' },
  { prefix: '/categories', title: 'Categories', subtitle: 'Organize ticket categories and subcategories.' },
  { prefix: '/custom-fields', title: 'Custom Fields', subtitle: 'Define custom fields per team for tickets.' },
  { prefix: '/reports', title: 'Reports', subtitle: 'Analytics and insights for helpdesk operations.' },
];

function resolveViewTitle(pathname: string, navKey: NavKey, role: Role): { title: string; subtitle: string } {
  const override = routeTitleOverrides.find((r) => pathname.startsWith(r.prefix));
  if (override) {
    return {
      title: override.title,
      subtitle: override.subtitle ?? viewMeta[navKey]?.subtitle ?? '',
    };
  }
  const meta = viewMeta[navKey];
  const title = meta?.title ?? 'Dashboard';
  let subtitle = meta?.subtitle ?? 'Quick view of your ticket activity and updates.';
  if (navKey === 'created' && role !== 'EMPLOYEE') {
    subtitle = 'Requests you have opened or own.';
  }
  return { title, subtitle };
}

/* ——— Authenticated shell ——— */

function AuthenticatedShell({ user, onSignOut }: { user: CurrentUserSession; onSignOut: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  // Extracted hooks (6.1)
  const currentEmail = user.email;
  const currentPersona = useMemo(
    () => ({ role: user.role as Role }),
    [user.role],
  );
  const personas = useMemo(
    () => [
      {
        label: `${user.displayName} (${user.email})`,
        email: user.email,
        role: user.role,
      },
    ],
    [user.displayName, user.email, user.role],
  );
  const setCurrentEmail = useCallback(() => {}, []);
  const sidebar = useSidebarState();
  const {
    refreshKey,
    notifyTicketAggregatesChanged,
    notifyTicketReportsChanged,
  } = useTicketDataInvalidation();

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

  const [navKey, setNavKey] = useState<NavKey>('dashboard');
  const [ticketPresetStatus, setTicketPresetStatus] = useState<StatusFilter>('open');
  const [ticketPresetScope, setTicketPresetScope] = useState<TicketScope>('all');

  // Command Palette
  const commandPalette = useCommandPalette({
    onCreateTicket: createTicketForm.openModal,
  });

  // Notifications
  const notifications = useNotifications({
    pollingInterval: 30000,
    enablePolling: true,
    userKey: currentEmail,
  });

  // Keyboard shortcuts
  const keyboardShortcuts = useKeyboardShortcuts();
  const shortcutContext = getShortcutContext(location.pathname);

  const adminMenuEnabled = canUseAdminMenu(currentPersona.role);
  const isAdminRoute = isAdminRoutePath(location.pathname);
  const showAdminSidebar = adminMenuEnabled && isAdminRoute && !sidebar.adminSidebarDismissed;
  const shellLayoutPath = isShellLayoutPath(location.pathname);
  const desktopMainOffset = showAdminSidebar ? 'lg:ml-64' : sidebar.isSidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64';
  const showMobileBackdrop = sidebar.isMobileViewport && (sidebar.mobileSidebarOpen || sidebar.mobileAdminSidebarOpen);

  /* ——— Derived state ——— */

  useEffect(() => {
    setNavKey(deriveNavKey(location.pathname, currentPersona.role, ticketPresetStatus, ticketPresetScope));
  }, [location.pathname, currentPersona.role, ticketPresetStatus, ticketPresetScope]);

  useEffect(() => {
    if (!isAdminRoute) sidebar.setAdminSidebarDismissed(false);
  }, [isAdminRoute]);

  useEffect(() => {
    fetchTeams()
      .then((response) => setTeamsList(response.data))
      .catch(() => setTeamsList([]));
  }, [currentEmail]);

  /* ——— Navigation handler (memoized, 6.3) ——— */

  const handleNavSelect = useCallback(
    (key: NavKey) => {
      sidebar.setMobileSidebarOpen(false);
      sidebar.setMobileAdminSidebarOpen(false);

      switch (key) {
        case 'dashboard': navigate('/dashboard'); return;
        case 'triage': navigate('/triage'); return;
        case 'manager': navigate('/manager'); return;
        case 'team': navigate('/team'); return;
        case 'sla-settings': navigate('/sla-settings'); return;
        case 'admin':
          sidebar.setAdminSidebarDismissed(false);
          navigate('/sla-settings');
          if (sidebar.isMobileViewport) sidebar.setMobileAdminSidebarOpen(true);
          return;
        case 'completed':
          setTicketPresetStatus('resolved');
          setTicketPresetScope('all');
          navigate('/tickets');
          return;
        case 'assigned':
          setTicketPresetStatus('open');
          setTicketPresetScope('assigned');
          navigate('/tickets');
          return;
        case 'unassigned':
          setTicketPresetStatus('open');
          setTicketPresetScope('unassigned');
          navigate('/tickets');
          return;
        case 'created':
          setTicketPresetStatus('open');
          setTicketPresetScope('created');
          navigate('/tickets');
          return;
        case 'tickets':
          setTicketPresetStatus('open');
          setTicketPresetScope('all');
          navigate('/tickets');
          return;
        default:
          navigate('/dashboard');
      }
    },
    [navigate, sidebar],
  );

  /* ——— Sidebar nav items (memoized, 6.3) ——— */

  const visibleNav = useMemo(() => {
    const filtered = navItems
      .filter((item) => item.roles.includes(currentPersona.role))
      .filter((item) => !(adminMenuEnabled && item.key === 'sla-settings'));
    return filtered.map((item) => ({
      key: item.key,
      label: item.label,
      icon: item.icon,
      badge:
        item.key === 'triage'
          ? ticketCounts?.triage
          : item.key === 'tickets'
            ? ticketCounts?.open
            : undefined,
      children: item.children?.map((child) => ({
        key: child.key,
        label: child.label,
        icon: child.icon,
        badge:
          child.key === 'assigned'
            ? ticketCounts?.assignedToMe
            : child.key === 'unassigned'
              ? ticketCounts?.unassigned
              : undefined,
      })),
    }));
  }, [adminMenuEnabled, currentPersona.role, ticketCounts]);

  /* ——— Header context value (6.2 – eliminates prop drilling) ——— */

  const { title: viewTitle, subtitle: viewSubtitle } = resolveViewTitle(
    location.pathname,
    navKey,
    currentPersona.role,
  );

  const headerValue: HeaderContextValue = useMemo(
    () => ({
      title: viewTitle,
      subtitle: viewSubtitle,
      currentEmail,
      personas,
      onEmailChange: setCurrentEmail,
      onOpenSearch: commandPalette.open,
      currentUser: user,
      onSignOut,
      notificationProps: {
        notifications: notifications.notifications,
        unreadCount: notifications.unreadCount,
        loading: notifications.loading,
        hasMore: notifications.hasMore,
        onLoadMore: notifications.loadMore,
        onMarkAsRead: notifications.markAsRead,
        onMarkAllAsRead: notifications.markAllAsRead,
        onRefresh: notifications.refresh,
      },
    }),
    [
      viewTitle, viewSubtitle, currentEmail, personas, setCurrentEmail,
      commandPalette.open, user, onSignOut, notifications,
    ],
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

  const isLeadOrAbove =
    currentPersona.role === 'LEAD' ||
    currentPersona.role === 'TEAM_ADMIN' ||
    currentPersona.role === 'OWNER';
  const isAdminOrOwner =
    currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER';

  return (
    <div className="min-h-screen overflow-hidden">
      <ToastContainer />
      <div className="flex">
        {/* Desktop sidebar */}
        <Sidebar
          collapsed={sidebar.isSidebarCollapsed}
          onToggle={() => sidebar.setIsSidebarCollapsed((prev) => !prev)}
          items={visibleNav}
          activeKey={navKey}
          onSelect={(key) => handleNavSelect(key as NavKey)}
          currentRole={currentPersona.role}
          onCreateTicket={createTicketForm.openModal}
          className="z-40 hidden lg:flex"
          showAdminSidebarTrigger={adminMenuEnabled && !showAdminSidebar}
          onOpenAdminSidebar={() => {
            sidebar.setAdminSidebarDismissed(false);
            if (!isAdminRoutePath(location.pathname)) navigate('/sla-settings');
          }}
        />

        {adminMenuEnabled && (
          <AdminSidebar
            visible={showAdminSidebar}
            role={currentPersona.role}
            pathname={location.pathname}
            onBack={() => sidebar.setAdminSidebarDismissed(true)}
            onNavigate={(route) => { sidebar.setAdminSidebarDismissed(false); navigate(route); }}
            className="hidden lg:block"
          />
        )}

        {/* Mobile backdrop */}
        {showMobileBackdrop && (
          <button
            type="button"
            onClick={() => { sidebar.setMobileSidebarOpen(false); sidebar.setMobileAdminSidebarOpen(false); }}
            className="fixed inset-0 z-40 bg-slate-900/35 lg:hidden"
            aria-label="Close navigation"
          />
        )}

        {/* Mobile sidebar */}
        <Sidebar
          collapsed={false}
          onToggle={() => sidebar.setMobileSidebarOpen(false)}
          hideCollapseToggle
          items={visibleNav}
          activeKey={navKey}
          onSelect={(key) => handleNavSelect(key as NavKey)}
          currentRole={currentPersona.role}
          onCreateTicket={createTicketForm.openModal}
          className={`z-50 lg:hidden ${sidebar.mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'}`}
          showAdminSidebarTrigger={adminMenuEnabled && !sidebar.mobileAdminSidebarOpen}
          onOpenAdminSidebar={() => {
            sidebar.setAdminSidebarDismissed(false);
            sidebar.setMobileSidebarOpen(false);
            sidebar.setMobileAdminSidebarOpen(true);
            if (!isAdminRoutePath(location.pathname)) navigate('/sla-settings');
          }}
        />

        {adminMenuEnabled && (
          <AdminSidebar
            visible={sidebar.mobileAdminSidebarOpen}
            role={currentPersona.role}
            pathname={location.pathname}
            onBack={() => { sidebar.setMobileAdminSidebarOpen(false); sidebar.setMobileSidebarOpen(true); }}
            onNavigate={(route) => { sidebar.setAdminSidebarDismissed(false); sidebar.setMobileAdminSidebarOpen(false); sidebar.setMobileSidebarOpen(false); navigate(route); }}
            className="z-[60] lg:hidden"
          />
        )}

        <main
          className={`flex-1 min-w-0 w-full transition-all duration-300 h-screen overflow-y-auto ${shellLayoutPath ? 'py-0' : 'py-8'} ${desktopMainOffset}`}
        >
          <button
            type="button"
            onClick={openMobileNavigation}
            className="fixed left-4 top-4 z-30 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 shadow-sm lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          {!shellLayoutPath && (
            <TopBar
              title={viewTitle}
              subtitle={viewSubtitle}
              currentEmail={currentEmail}
              personas={personas}
              onEmailChange={setCurrentEmail}
              onOpenSearch={commandPalette.open}
              notificationProps={headerValue.notificationProps}
              user={user}
              onSignOut={onSignOut}
            />
          )}

          {/* HeaderProvider eliminates headerProps prop drilling (6.2) */}
          <HeaderProvider value={headerValue}>
            {/* Route-level error boundary (2.2 fix) – resets automatically on navigation
                because the key changes with the pathname. */}
            <ErrorBoundary
              key={location.pathname}
              fallback={(props) => <RouteErrorFallback {...props} />}
            >
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<DashboardPage refreshKey={refreshKey} role={currentPersona.role} />} />
                  <Route path="/triage" element={isLeadOrAbove ? <TriageBoardPage refreshKey={refreshKey} teamsList={teamsList} role={currentPersona.role} /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/manager" element={isLeadOrAbove ? <ManagerViewsPage refreshKey={refreshKey} teamsList={teamsList} /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/team" element={isLeadOrAbove ? <TeamPage refreshKey={refreshKey} teamsList={teamsList} role={currentPersona.role} /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/sla-settings" element={isLeadOrAbove ? <SlaSettingsPage teamsList={teamsList} role={currentPersona.role} /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/reports" element={isAdminOrOwner ? <ReportsPage refreshKey={refreshKey} role={currentPersona.role} /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/admin" element={isAdminOrOwner ? <Navigate to="/sla-settings" replace /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/routing" element={isAdminOrOwner ? <RoutingRulesPage teamsList={teamsList} role={currentPersona.role} /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/automation" element={isAdminOrOwner ? <AutomationRulesPage role={currentPersona.role} teamsList={teamsList} /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/audit-log" element={isAdminOrOwner ? <AuditLogPage /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/categories" element={currentPersona.role === 'OWNER' ? <CategoriesPage /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/custom-fields" element={isAdminOrOwner ? <CustomFieldsAdminPage role={currentPersona.role} /> : <Navigate to="/dashboard" replace />} />
                  <Route path="/tickets" element={<TicketsPage role={currentPersona.role} currentEmail={currentEmail} presetStatus={ticketPresetStatus} presetScope={ticketPresetScope} refreshKey={refreshKey} teamsList={teamsList} onCreateTicket={createTicketForm.openModal} />} />
                  <Route path="/tickets/:ticketId" element={<TicketDetailPage refreshKey={refreshKey} currentEmail={currentEmail} role={currentPersona.role} teamsList={teamsList} />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </HeaderProvider>
        </main>
      </div>

      <CommandPalette
        isOpen={commandPalette.isOpen}
        onClose={commandPalette.close}
        recentSearches={commandPalette.recentSearches}
        onSearch={commandPalette.addRecentSearch}
        onClearRecent={commandPalette.clearRecentSearches}
        onCreateTicket={createTicketForm.openModal}
        currentRole={currentPersona.role}
      />

      <KeyboardShortcutsHelp
        open={keyboardShortcuts.showHelp}
        onClose={keyboardShortcuts.closeHelp}
        context={shortcutContext}
      />

      <CreateTicketModal
        open={createTicketForm.showModal}
        onClose={createTicketForm.closeModal}
        onSubmit={createTicketForm.handleSubmit}
        error={createTicketForm.error}
        teams={teamsList}
        categories={createTicketForm.categories}
        customFields={createTicketForm.customFields}
        customFieldValues={createTicketForm.customFieldValues}
        onCustomFieldChange={createTicketForm.onCustomFieldChange}
        onTeamChange={createTicketForm.setSelectedTeamId}
        onCategoryChange={createTicketForm.setSelectedCategoryId}
      />
    </div>
  );
}

/* ——— Main App component ——— */

function App() {
  const auth = useAuthSession();

  if (auth.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
      </div>
    );
  }

  if (!auth.user) {
    return (
      <AuthRequiredScreen
        onSignIn={() => {
          void auth.signIn();
        }}
        error={auth.error}
      />
    );
  }

  return <AuthenticatedShell user={auth.user} onSignOut={auth.signOut} />;
}

export default App;
