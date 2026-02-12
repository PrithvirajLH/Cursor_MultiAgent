import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle,
  ClipboardList,
  Clock,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Settings,
  Ticket,
  Users
} from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  createTicket,
  fetchCategories,
  fetchCustomFields,
  fetchTeams,
  fetchTicketCounts,
  getDemoUserEmail,
  setDemoUserEmail,
  type CategoryRef,
  type CustomFieldRecord,
  type TeamRef
} from './api/client';
import { CommandPalette } from './components/CommandPalette';
import { CreateTicketModal, type CreateTicketForm } from './components/CreateTicketModal';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import { AdminSidebar } from './components/AdminSidebar';
import { Sidebar, type SidebarItem } from './components/Sidebar';
import { ToastContainer } from './components/ToastContainer';
import { TopBar } from './components/TopBar';
import { useCommandPalette } from './hooks/useCommandPalette';
import { getShortcutContext, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useNotifications } from './hooks/useNotifications';
import { useToast } from './hooks/useToast';
import { DashboardPage } from './pages/DashboardPage';
import { ManagerViewsPage } from './pages/ManagerViewsPage';
import { SlaSettingsPage } from './pages/SlaSettingsPage';
import { ReportsPage } from './pages/ReportsPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { AutomationRulesPage } from './pages/AutomationRulesPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RoutingRulesPage } from './pages/RoutingRulesPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CustomFieldsAdminPage } from './pages/CustomFieldsAdminPage';
import { TeamPage } from './pages/TeamPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { TicketsPage } from './pages/TicketsPage';
import { TriageBoardPage } from './pages/TriageBoardPage';
import type { Role, StatusFilter, TicketScope } from './types';

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

const defaultPersonas: { label: string; email: string; role: Role }[] = [
  { label: 'Employee (Jane)', email: 'jane.doe@company.com', role: 'EMPLOYEE' },
  { label: 'Agent (Alex)', email: 'alex.park@company.com', role: 'AGENT' },
  { label: 'Lead (Maria)', email: 'maria.chen@company.com', role: 'LEAD' },
  { label: 'Team Admin (Sam)', email: 'sam.rivera@company.com', role: 'TEAM_ADMIN' },
  { label: 'Owner', email: 'owner@company.com', role: 'OWNER' }
];

const e2ePersonas: { label: string; email: string; role: Role }[] = [
  { label: 'Requester (Test)', email: 'requester@company.com', role: 'EMPLOYEE' },
  { label: 'Agent (Test)', email: 'agent@company.com', role: 'AGENT' },
  { label: 'Lead (Test)', email: 'lead@company.com', role: 'LEAD' },
  { label: 'Team Admin (Test)', email: 'admin@company.com', role: 'TEAM_ADMIN' },
  { label: 'Owner (Test)', email: 'owner@company.com', role: 'OWNER' }
];

const personas = import.meta.env.VITE_E2E_MODE === 'true' ? e2ePersonas : defaultPersonas;

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
  if (pathname === '/tickets' || pathname.startsWith('/tickets/')) {
    return true;
  }
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
  if (pathname.startsWith('/triage')) {
    return 'triage';
  }
  if (pathname.startsWith('/manager')) {
    return 'manager';
  }
  if (pathname.startsWith('/team')) {
    return 'team';
  }
  if (pathname.startsWith('/sla-settings')) {
    return canUseAdminMenu(role) ? 'admin' : 'sla-settings';
  }
  if (
    pathname.startsWith('/routing') ||
    pathname.startsWith('/automation') ||
    pathname.startsWith('/audit-log') ||
    pathname.startsWith('/categories') ||
    pathname.startsWith('/custom-fields') ||
    pathname.startsWith('/reports')
  ) {
    return 'admin';
  }
  if (pathname.startsWith('/admin')) {
    return 'admin';
  }
  if (pathname.startsWith('/tickets')) {
    if (ticketPresetScope === 'assigned') {
      return 'assigned';
    }
    if (ticketPresetScope === 'unassigned') {
      return 'unassigned';
    }
    if (ticketPresetScope === 'created') {
      return 'created';
    }
    if (ticketPresetStatus === 'resolved') {
      return 'completed';
    }
    return role === 'EMPLOYEE' ? 'created' : 'tickets';
  }
  return 'dashboard';
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const [currentEmail, setCurrentEmail] = useState(() => getDemoUserEmail() || personas[0].email);
  const currentPersona = useMemo(
    () => personas.find((persona) => persona.email === currentEmail) ?? personas[0],
    [currentEmail]
  );

  useEffect(() => {
    const isValid = personas.some((persona) => persona.email === currentEmail);
    if (!isValid) {
      setCurrentEmail(personas[0].email);
    }
  }, [currentEmail, personas]);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem('sidebar-collapsed') === 'true';
  });
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia('(max-width: 1023px)').matches;
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileAdminSidebarOpen, setMobileAdminSidebarOpen] = useState(false);
  const [adminSidebarDismissed, setAdminSidebarDismissed] = useState(false);

  const [navKey, setNavKey] = useState<NavKey>('dashboard');
  const [ticketPresetStatus, setTicketPresetStatus] = useState<StatusFilter>('open');
  const [ticketPresetScope, setTicketPresetScope] = useState<TicketScope>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  const [teamsList, setTeamsList] = useState<TeamRef[]>([]);
  const [ticketCounts, setTicketCounts] = useState<{
    assignedToMe: number;
    triage: number;
    open: number;
    unassigned: number;
  } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);

  // Command Palette state with Cmd+N shortcut for new ticket
  const commandPalette = useCommandPalette({
    onCreateTicket: () => setShowCreateModal(true)
  });

  // Notifications state with polling
  // Pass currentEmail as userKey to reset notifications on persona switch
  const notifications = useNotifications({
    pollingInterval: 30000, // 30 seconds
    enablePolling: true,
    userKey: currentEmail
  });

  // Keyboard shortcuts: ? (help), Cmd+/ (focus search)
  const keyboardShortcuts = useKeyboardShortcuts();
  const shortcutContext = getShortcutContext(location.pathname);

  const [createForm, setCreateForm] = useState<CreateTicketForm>({
    subject: '',
    description: '',
    priority: 'P3',
    channel: 'PORTAL',
    assignedTeamId: '',
    categoryId: ''
  });
  const [createCategories, setCreateCategories] = useState<CategoryRef[]>([]);
  const [createCustomFieldsRaw, setCreateCustomFieldsRaw] = useState<CustomFieldRecord[]>([]);
  const [createCustomFieldValues, setCreateCustomFieldValues] = useState<Record<string, string>>({});
  const adminMenuEnabled = canUseAdminMenu(currentPersona.role);
  const isAdminRoute = isAdminRoutePath(location.pathname);
  const showAdminSidebar = adminMenuEnabled && isAdminRoute && !adminSidebarDismissed;
  const shellLayoutPath = isShellLayoutPath(location.pathname);
  const desktopMainOffset = showAdminSidebar ? 'lg:ml-64' : isSidebarCollapsed ? 'lg:ml-20' : 'lg:ml-64';
  const showMobileBackdrop = isMobileViewport && (mobileSidebarOpen || mobileAdminSidebarOpen);

  const createCustomFields = useMemo(() => {
    if (!createForm.categoryId) return createCustomFieldsRaw;
    return createCustomFieldsRaw.filter(
      (f) => !f.categoryId || f.categoryId === createForm.categoryId
    );
  }, [createCustomFieldsRaw, createForm.categoryId]);

  useEffect(() => {
    setDemoUserEmail(currentEmail);
  }, [currentEmail]);

  useEffect(() => {
    fetchCategories({ includeInactive: false })
      .then((res) => setCreateCategories(res.data))
      .catch(() => setCreateCategories([]));
  }, []);

  useEffect(() => {
    if (!createForm.assignedTeamId) {
      setCreateCustomFieldsRaw([]);
      setCreateCustomFieldValues({});
      return;
    }
    fetchCustomFields({ teamId: createForm.assignedTeamId })
      .then((res) => setCreateCustomFieldsRaw(res.data))
      .catch(() => setCreateCustomFieldsRaw([]));
    setCreateCustomFieldValues({});
  }, [createForm.assignedTeamId]);

  useEffect(() => {
    setNavKey(deriveNavKey(location.pathname, currentPersona.role, ticketPresetStatus, ticketPresetScope));
  }, [location.pathname, currentPersona.role, ticketPresetStatus, ticketPresetScope]);

  useEffect(() => {
    if (!isAdminRoute) {
      setAdminSidebarDismissed(false);
    }
  }, [isAdminRoute]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 1023px)');
    const syncViewport = () => setIsMobileViewport(media.matches);
    syncViewport();
    media.addEventListener('change', syncViewport);
    return () => media.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setMobileSidebarOpen(false);
      setMobileAdminSidebarOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    setMobileSidebarOpen(false);
    setMobileAdminSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('sidebar-collapsed', String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    fetchTeams()
      .then((response) => setTeamsList(response.data))
      .catch(() => setTeamsList([]));
  }, [currentEmail]);

  useEffect(() => {
    fetchTicketCounts()
      .then(setTicketCounts)
      .catch(() => setTicketCounts(null));
  }, [currentEmail, refreshKey]);

  function handleNavSelect(key: NavKey) {
    setMobileSidebarOpen(false);
    setMobileAdminSidebarOpen(false);

    if (key === 'dashboard') {
      navigate('/dashboard');
      return;
    }

    if (key === 'triage') {
      navigate('/triage');
      return;
    }

    if (key === 'manager') {
      navigate('/manager');
      return;
    }

    if (key === 'team') {
      navigate('/team');
      return;
    }
    if (key === 'sla-settings') {
      navigate('/sla-settings');
      return;
    }
    if (key === 'admin') {
      setAdminSidebarDismissed(false);
      navigate('/sla-settings');
      if (isMobileViewport) {
        setMobileAdminSidebarOpen(true);
      }
      return;
    }

    if (key === 'completed') {
      setTicketPresetStatus('resolved');
      setTicketPresetScope('all');
      navigate('/tickets');
      return;
    }

    if (key === 'assigned') {
      setTicketPresetStatus('open');
      setTicketPresetScope('assigned');
      navigate('/tickets');
      return;
    }

    if (key === 'unassigned') {
      setTicketPresetStatus('open');
      setTicketPresetScope('unassigned');
      navigate('/tickets');
      return;
    }

    if (key === 'created') {
      setTicketPresetStatus('open');
      setTicketPresetScope('created');
      navigate('/tickets');
      return;
    }

    if (key === 'tickets') {
      setTicketPresetStatus('open');
      setTicketPresetScope('all');
      navigate('/tickets');
      return;
    }

    navigate('/dashboard');
  }

  async function handleCreateTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTicketError(null);
    const missingRequired = createCustomFields.filter(
      (f) => f.isRequired && !(createCustomFieldValues[f.id]?.trim?.() ?? '')
    );
    if (missingRequired.length > 0) {
      const names = missingRequired.map((f) => f.name).join(', ');
      const msg = `Required field(s) must be filled: ${names}`;
      setTicketError(msg);
      toast.error(msg);
      return;
    }
    try {
      const customFieldValuesPayload =
        createCustomFields.length > 0
          ? createCustomFields.map((f) => ({
              customFieldId: f.id,
              value: (createCustomFieldValues[f.id]?.trim?.() ?? '') || null
            }))
          : [];
      await createTicket({
        subject: createForm.subject,
        description: createForm.description,
        priority: createForm.priority,
        channel: createForm.channel,
        ...(createForm.assignedTeamId && { assignedTeamId: createForm.assignedTeamId }),
        ...(createForm.categoryId && { categoryId: createForm.categoryId }),
        ...(customFieldValuesPayload.length > 0 && { customFieldValues: customFieldValuesPayload })
      });
      setCreateForm({ subject: '', description: '', priority: 'P3', channel: 'PORTAL', assignedTeamId: '', categoryId: '' });
      setCreateCustomFieldValues({});
      setShowCreateModal(false);
      setRefreshKey((prev) => prev + 1);
      toast.success('Ticket created successfully.');
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error != null && 'message' in error
            ? String((error as { message: unknown }).message)
            : 'Unable to create ticket.';
      const hint =
        message === 'Missing user header' || message === 'Unknown user'
          ? ' Ensure you have selected a user (persona) in the top bar and the API is running (e.g. npm run dev in the api app).'
          : /fetch|network|failed/i.test(message)
            ? ' Ensure the API is running at the URL in VITE_API_BASE_URL (default http://localhost:3000/api).'
            : '';
      const display = message + hint;
      setTicketError(display);
      toast.error(display);
    }
  }

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

  const viewMeta: Record<NavKey, { title: string; subtitle: string }> = {
    dashboard: {
      title: 'Dashboard',
      subtitle: 'Quick view of your ticket activity and updates.'
    },
    tickets: {
      title: 'All Tickets',
      subtitle: 'Track, filter, and manage your support requests.'
    },
    assigned: {
      title: 'Assigned to Me',
      subtitle: 'Tickets waiting for your action.'
    },
    unassigned: {
      title: 'Unassigned',
      subtitle: 'Tickets waiting to be picked up.'
    },
    created: {
      title: currentPersona.role === 'EMPLOYEE' ? 'My Tickets' : 'Created by Me',
      subtitle: 'Requests you have opened or own.'
    },
    completed: {
      title: 'Completed',
      subtitle: 'Closed and resolved tickets.'
    },
    triage: {
      title: 'Triage Board',
      subtitle: 'Monitor open tickets by status.'
    },
    manager: {
      title: 'Manager Views',
      subtitle: 'High-level ticket volume and workload insights.'
    },
    team: {
      title: 'Team',
      subtitle: 'Manage members and roles.'
    },
    'sla-settings': {
      title: 'SLA Settings',
      subtitle: 'Configure SLA targets per department.'
    },
    admin: {
      title: 'Admin',
      subtitle: 'Configuration and settings.'
    }
  };

  const viewTitleOverride = location.pathname.startsWith('/routing')
    ? 'Routing Rules'
    : location.pathname.startsWith('/automation')
    ? 'Automation Rules'
    : location.pathname.startsWith('/audit-log')
    ? 'Audit Log'
    : location.pathname.startsWith('/categories')
    ? 'Categories'
    : location.pathname.startsWith('/custom-fields')
    ? 'Custom Fields'
    : undefined;
  const viewSubtitleOverride = location.pathname.startsWith('/routing')
    ? 'Manage keyword-based routing logic.'
    : location.pathname.startsWith('/automation')
    ? 'Run actions when tickets are created, status changes, or SLA is at risk.'
    : location.pathname.startsWith('/reports')
    ? 'Analytics and insights for helpdesk operations.'
    : location.pathname.startsWith('/audit-log')
    ? 'Ticket changes and actions for compliance and troubleshooting.'
    : location.pathname.startsWith('/categories')
    ? 'Organize ticket categories and subcategories.'
    : location.pathname.startsWith('/custom-fields')
    ? 'Define custom fields per team for tickets.'
    : undefined;

  const viewTitle = viewTitleOverride ?? viewMeta[navKey]?.title ?? 'Dashboard';
  const viewSubtitle =
    viewSubtitleOverride ?? viewMeta[navKey]?.subtitle ?? 'Quick view of your ticket activity and updates.';

  function openMobileNavigation() {
    if (adminMenuEnabled && isAdminRoute && !adminSidebarDismissed) {
      setMobileAdminSidebarOpen(true);
      setMobileSidebarOpen(false);
      return;
    }
    setMobileSidebarOpen(true);
    setMobileAdminSidebarOpen(false);
  }

  return (
    <div className="min-h-screen overflow-hidden">
      <ToastContainer />
      <div className="flex">
        <Sidebar
          collapsed={isSidebarCollapsed}
          onToggle={() => setIsSidebarCollapsed((prev) => !prev)}
          items={visibleNav}
          activeKey={navKey}
          onSelect={(key) => handleNavSelect(key as NavKey)}
          currentRole={currentPersona.role}
          onCreateTicket={() => setShowCreateModal(true)}
          className="z-40 hidden lg:flex"
          showAdminSidebarTrigger={adminMenuEnabled && !showAdminSidebar}
          onOpenAdminSidebar={() => {
            setAdminSidebarDismissed(false);
            if (!isAdminRoutePath(location.pathname)) {
              navigate('/sla-settings');
            }
          }}
        />
        {adminMenuEnabled && (
          <AdminSidebar
            visible={showAdminSidebar}
            role={currentPersona.role}
            pathname={location.pathname}
            onBack={() => setAdminSidebarDismissed(true)}
            onNavigate={(route) => {
              setAdminSidebarDismissed(false);
              navigate(route);
            }}
            className="hidden lg:block"
          />
        )}

        {showMobileBackdrop && (
          <button
            type="button"
            onClick={() => {
              setMobileSidebarOpen(false);
              setMobileAdminSidebarOpen(false);
            }}
            className="fixed inset-0 z-40 bg-slate-900/35 lg:hidden"
            aria-label="Close navigation"
          />
        )}

        <Sidebar
          collapsed={false}
          onToggle={() => setMobileSidebarOpen(false)}
          hideCollapseToggle
          items={visibleNav}
          activeKey={navKey}
          onSelect={(key) => handleNavSelect(key as NavKey)}
          currentRole={currentPersona.role}
          onCreateTicket={() => setShowCreateModal(true)}
          className={`z-50 lg:hidden ${
            mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
          }`}
          showAdminSidebarTrigger={adminMenuEnabled && !mobileAdminSidebarOpen}
          onOpenAdminSidebar={() => {
            setAdminSidebarDismissed(false);
            setMobileSidebarOpen(false);
            setMobileAdminSidebarOpen(true);
            if (!isAdminRoutePath(location.pathname)) {
              navigate('/sla-settings');
            }
          }}
        />

        {adminMenuEnabled && (
          <AdminSidebar
            visible={mobileAdminSidebarOpen}
            role={currentPersona.role}
            pathname={location.pathname}
            onBack={() => {
              setMobileAdminSidebarOpen(false);
              setMobileSidebarOpen(true);
            }}
            onNavigate={(route) => {
              setAdminSidebarDismissed(false);
              setMobileAdminSidebarOpen(false);
              setMobileSidebarOpen(false);
              navigate(route);
            }}
            className="z-[60] lg:hidden"
          />
        )}

        <main
          className={`flex-1 min-w-0 w-full transition-all duration-300 h-screen overflow-y-auto ${
            shellLayoutPath ? 'py-0' : 'py-8'
          } ${desktopMainOffset}`}
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
              notificationProps={{
                notifications: notifications.notifications,
                unreadCount: notifications.unreadCount,
                loading: notifications.loading,
                hasMore: notifications.hasMore,
                onLoadMore: notifications.loadMore,
                onMarkAsRead: notifications.markAsRead,
                onMarkAllAsRead: notifications.markAllAsRead,
                onRefresh: notifications.refresh
              }}
            />
          )}

          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/dashboard"
              element={
                <DashboardPage
                  refreshKey={refreshKey}
                  role={currentPersona.role}
                  headerProps={{
                    title: viewMeta.dashboard.title,
                    subtitle: viewMeta.dashboard.subtitle,
                    currentEmail,
                    personas,
                    onEmailChange: setCurrentEmail,
                    onOpenSearch: commandPalette.open,
                    notificationProps: {
                      notifications: notifications.notifications,
                      unreadCount: notifications.unreadCount,
                      loading: notifications.loading,
                      hasMore: notifications.hasMore,
                      onLoadMore: notifications.loadMore,
                      onMarkAsRead: notifications.markAsRead,
                      onMarkAllAsRead: notifications.markAllAsRead,
                      onRefresh: notifications.refresh
                    }
                  }}
                />
              }
            />
            <Route
              path="/triage"
              element={
                currentPersona.role === 'LEAD' || currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER' ? (
                  <TriageBoardPage
                    refreshKey={refreshKey}
                    teamsList={teamsList}
                    role={currentPersona.role}
                    headerProps={{
                      title: viewTitle,
                      subtitle: viewSubtitle,
                      currentEmail,
                      personas,
                      onEmailChange: setCurrentEmail,
                      onOpenSearch: commandPalette.open,
                      notificationProps: {
                        notifications: notifications.notifications,
                        unreadCount: notifications.unreadCount,
                        loading: notifications.loading,
                        hasMore: notifications.hasMore,
                        onLoadMore: notifications.loadMore,
                        onMarkAsRead: notifications.markAsRead,
                        onMarkAllAsRead: notifications.markAllAsRead,
                        onRefresh: notifications.refresh
                      }
                    }}
                  />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/manager"
              element={
                currentPersona.role === 'LEAD' || currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER' ? (
                  <ManagerViewsPage
                    refreshKey={refreshKey}
                    teamsList={teamsList}
                    headerProps={{
                      title: viewTitle,
                      subtitle: viewSubtitle,
                      currentEmail,
                      personas,
                      onEmailChange: setCurrentEmail,
                      onOpenSearch: commandPalette.open,
                      notificationProps: {
                        notifications: notifications.notifications,
                        unreadCount: notifications.unreadCount,
                        loading: notifications.loading,
                        hasMore: notifications.hasMore,
                        onLoadMore: notifications.loadMore,
                        onMarkAsRead: notifications.markAsRead,
                        onMarkAllAsRead: notifications.markAllAsRead,
                        onRefresh: notifications.refresh
                      }
                    }}
                  />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/team"
              element={
                currentPersona.role === 'LEAD' || currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER' ? (
                  <TeamPage
                    refreshKey={refreshKey}
                    teamsList={teamsList}
                    role={currentPersona.role}
                    headerProps={{
                      title: viewTitle,
                      subtitle: viewSubtitle,
                      currentEmail,
                      personas,
                      onEmailChange: setCurrentEmail,
                      onOpenSearch: commandPalette.open,
                      notificationProps: {
                        notifications: notifications.notifications,
                        unreadCount: notifications.unreadCount,
                        loading: notifications.loading,
                        hasMore: notifications.hasMore,
                        onLoadMore: notifications.loadMore,
                        onMarkAsRead: notifications.markAsRead,
                        onMarkAllAsRead: notifications.markAllAsRead,
                        onRefresh: notifications.refresh
                      }
                    }}
                  />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/sla-settings"
              element={
                currentPersona.role === 'LEAD' || currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER' ? (
                  <SlaSettingsPage
                    teamsList={teamsList}
                    role={currentPersona.role}
                    headerProps={{
                      title: viewTitle,
                      subtitle: viewSubtitle,
                      currentEmail,
                      personas,
                      onEmailChange: setCurrentEmail,
                      onOpenSearch: commandPalette.open,
                      notificationProps: {
                        notifications: notifications.notifications,
                        unreadCount: notifications.unreadCount,
                        loading: notifications.loading,
                        hasMore: notifications.hasMore,
                        onLoadMore: notifications.loadMore,
                        onMarkAsRead: notifications.markAsRead,
                        onMarkAllAsRead: notifications.markAllAsRead,
                        onRefresh: notifications.refresh
                      }
                    }}
                  />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/reports"
              element={
                currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER' ? (
                  <ReportsPage
                    role={currentPersona.role}
                    headerProps={{
                      title: viewTitle,
                      subtitle: viewSubtitle,
                      currentEmail,
                      personas,
                      onEmailChange: setCurrentEmail,
                      onOpenSearch: commandPalette.open,
                      notificationProps: {
                        notifications: notifications.notifications,
                        unreadCount: notifications.unreadCount,
                        loading: notifications.loading,
                        hasMore: notifications.hasMore,
                        onLoadMore: notifications.loadMore,
                        onMarkAsRead: notifications.markAsRead,
                        onMarkAllAsRead: notifications.markAllAsRead,
                        onRefresh: notifications.refresh
                      }
                    }}
                  />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/admin"
              element={
                currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER' ? (
                  <Navigate to="/sla-settings" replace />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/routing"
              element={
                currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER' ? (
                  <RoutingRulesPage
                    teamsList={teamsList}
                    headerProps={{
                      title: viewTitle,
                      subtitle: viewSubtitle,
                      currentEmail,
                      personas,
                      onEmailChange: setCurrentEmail,
                      onOpenSearch: commandPalette.open,
                      notificationProps: {
                        notifications: notifications.notifications,
                        unreadCount: notifications.unreadCount,
                        loading: notifications.loading,
                        hasMore: notifications.hasMore,
                        onLoadMore: notifications.loadMore,
                        onMarkAsRead: notifications.markAsRead,
                        onMarkAllAsRead: notifications.markAllAsRead,
                        onRefresh: notifications.refresh
                      }
                    }}
                  />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/automation"
              element={
                currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER' ? (
                  <AutomationRulesPage
                    role={currentPersona.role}
                    teamsList={teamsList}
                    headerProps={{
                      title: viewTitle,
                      subtitle: viewSubtitle,
                      currentEmail,
                      personas,
                      onEmailChange: setCurrentEmail,
                      onOpenSearch: commandPalette.open,
                      notificationProps: {
                        notifications: notifications.notifications,
                        unreadCount: notifications.unreadCount,
                        loading: notifications.loading,
                        hasMore: notifications.hasMore,
                        onLoadMore: notifications.loadMore,
                        onMarkAsRead: notifications.markAsRead,
                        onMarkAllAsRead: notifications.markAllAsRead,
                        onRefresh: notifications.refresh
                      }
                    }}
                  />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/audit-log"
              element={
                currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER' ? (
                  <AuditLogPage
                    headerProps={{
                      title: viewTitle,
                      subtitle: viewSubtitle,
                      currentEmail,
                      personas,
                      onEmailChange: setCurrentEmail,
                      onOpenSearch: commandPalette.open,
                      notificationProps: {
                        notifications: notifications.notifications,
                        unreadCount: notifications.unreadCount,
                        loading: notifications.loading,
                        hasMore: notifications.hasMore,
                        onLoadMore: notifications.loadMore,
                        onMarkAsRead: notifications.markAsRead,
                        onMarkAllAsRead: notifications.markAllAsRead,
                        onRefresh: notifications.refresh
                      }
                    }}
                  />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/categories"
              element={
                currentPersona.role === 'OWNER' ? (
                  <CategoriesPage
                    headerProps={{
                      title: viewTitle,
                      subtitle: viewSubtitle,
                      currentEmail,
                      personas,
                      onEmailChange: setCurrentEmail,
                      onOpenSearch: commandPalette.open,
                      notificationProps: {
                        notifications: notifications.notifications,
                        unreadCount: notifications.unreadCount,
                        loading: notifications.loading,
                        hasMore: notifications.hasMore,
                        onLoadMore: notifications.loadMore,
                        onMarkAsRead: notifications.markAsRead,
                        onMarkAllAsRead: notifications.markAllAsRead,
                        onRefresh: notifications.refresh
                      }
                    }}
                  />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/custom-fields"
              element={
                currentPersona.role === 'TEAM_ADMIN' || currentPersona.role === 'OWNER' ? (
                  <CustomFieldsAdminPage
                    role={currentPersona.role}
                    headerProps={{
                      title: viewTitle,
                      subtitle: viewSubtitle,
                      currentEmail,
                      personas,
                      onEmailChange: setCurrentEmail,
                      onOpenSearch: commandPalette.open,
                      notificationProps: {
                        notifications: notifications.notifications,
                        unreadCount: notifications.unreadCount,
                        loading: notifications.loading,
                        hasMore: notifications.hasMore,
                        onLoadMore: notifications.loadMore,
                        onMarkAsRead: notifications.markAsRead,
                        onMarkAllAsRead: notifications.markAllAsRead,
                        onRefresh: notifications.refresh
                      }
                    }}
                  />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />
            <Route
              path="/tickets"
              element={
                <TicketsPage
                  role={currentPersona.role}
                  currentEmail={currentEmail}
                  presetStatus={ticketPresetStatus}
                  presetScope={ticketPresetScope}
                  refreshKey={refreshKey}
                  teamsList={teamsList}
                  onCreateTicket={() => setShowCreateModal(true)}
                  headerProps={{
                    title: viewTitle,
                    subtitle: viewSubtitle,
                    currentEmail,
                    personas,
                    onEmailChange: setCurrentEmail,
                    onOpenSearch: commandPalette.open,
                    notificationProps: {
                      notifications: notifications.notifications,
                      unreadCount: notifications.unreadCount,
                      loading: notifications.loading,
                      hasMore: notifications.hasMore,
                      onLoadMore: notifications.loadMore,
                      onMarkAsRead: notifications.markAsRead,
                      onMarkAllAsRead: notifications.markAllAsRead,
                      onRefresh: notifications.refresh
                    }
                  }}
                />
              }
            />
            <Route
              path="/tickets/:ticketId"
              element={
                <TicketDetailPage
                  refreshKey={refreshKey}
                  currentEmail={currentEmail}
                  role={currentPersona.role}
                  teamsList={teamsList}
                  headerProps={{
                    title: 'Ticket details',
                    subtitle: 'Review context, collaborate, and update workflow in one workspace.',
                    currentEmail,
                    personas,
                    onEmailChange: setCurrentEmail,
                    onOpenSearch: commandPalette.open,
                    notificationProps: {
                      notifications: notifications.notifications,
                      unreadCount: notifications.unreadCount,
                      loading: notifications.loading,
                      hasMore: notifications.hasMore,
                      onLoadMore: notifications.loadMore,
                      onMarkAsRead: notifications.markAsRead,
                      onMarkAllAsRead: notifications.markAllAsRead,
                      onRefresh: notifications.refresh
                    }
                  }}
                />
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>

      <CommandPalette
        isOpen={commandPalette.isOpen}
        onClose={commandPalette.close}
        recentSearches={commandPalette.recentSearches}
        onSearch={commandPalette.addRecentSearch}
        onClearRecent={commandPalette.clearRecentSearches}
        onCreateTicket={() => setShowCreateModal(true)}
        currentRole={currentPersona.role}
      />

      <KeyboardShortcutsHelp
        open={keyboardShortcuts.showHelp}
        onClose={keyboardShortcuts.closeHelp}
        context={shortcutContext}
      />

      <CreateTicketModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateTicket}
        error={ticketError}
        teams={teamsList}
        categories={createCategories}
        form={createForm}
        onChange={(field, value) => setCreateForm((prev) => ({ ...prev, [field]: value }))}
        customFields={createCustomFields}
        customFieldValues={createCustomFieldValues}
        onCustomFieldChange={(fieldId, value) =>
          setCreateCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }))
        }
      />
    </div>
  );
}

export default App;
