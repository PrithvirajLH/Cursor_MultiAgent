import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AlertCircle,
  ChevronDown,
  ShieldAlert,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  addTeamMember,
  createTeam,
  deactivateUser,
  fetchAllTeamsAdmin,
  fetchAllUsers,
  fetchTeamMembers,
  previewUserDeactivation,
  reactivateUser,
  removeTeamMember,
  setUserPrimaryTeam,
  updateTeam,
  updateTeamMember,
  updateUserRole,
  type TeamMember,
  type TeamRef,
  type UserRef,
} from "../api/client";

const INACTIVE_USERS_SENTINEL = "__inactive_users__";
const INACTIVE_TEAMS_SENTINEL = "__inactive_teams__";

const ASSIGNMENT_STRATEGY_OPTIONS = [
  { value: "QUEUE_ONLY", label: "Queue only (manual pickup)" },
  { value: "ROUND_ROBIN", label: "Round robin (auto-rotate)" },
] as const;

type TeamFormState = {
  mode: "create" | "edit";
  teamId?: string;
  name: string;
  description: string;
  assignmentStrategy: string;
};

type DeactivationTarget = {
  userId: string;
  displayName: string;
  email: string;
};

type DeactivationPreview = {
  ticketsOpen: number;
  teams: string[];
};
import { TopBar } from "../components/TopBar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useTicketDataInvalidation } from "../contexts/TicketDataInvalidationContext";
import {
  REALTIME_ADMIN_CHANGED_EVENT,
  type RealtimeAdminChangedEventPayload,
} from "../realtime/events";
import type { Role } from "../types";

const ELIGIBLE_MEMBER_USER_ROLES = new Set([
  "EMPLOYEE",
  "AGENT",
  "LEAD",
  "TEAM_ADMIN",
]);

function getRoleDropdownOptions(
  userRole: string | null | undefined,
  isOwnerViewer: boolean,
): string[] {
  if (userRole === "EMPLOYEE") {
    return ["AGENT"];
  }
  if (userRole === "TEAM_ADMIN") {
    return isOwnerViewer ? ["AGENT", "LEAD", "TEAM_ADMIN"] : ["ADMIN"];
  }
  return isOwnerViewer ? ["AGENT", "LEAD", "TEAM_ADMIN"] : ["AGENT", "LEAD"];
}

function RoleBadge({ role }: { role: string }) {
  const label = role === "TEAM_ADMIN" ? "TEAM ADMIN" : role;
  const tone =
    role === "ADMIN" || role === "TEAM_ADMIN"
      ? "bg-orange-100 text-orange-700"
      : role === "LEAD"
        ? "bg-purple-100 text-purple-700"
        : "bg-blue-100 text-blue-700";
  return (
    <span className={`rounded-lg px-2 py-1 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

function MemberRoleDropdown({
  member,
  disabled,
  isOwnerViewer,
  currentTeamId,
  onChange,
}: {
  member: TeamMember;
  disabled: boolean;
  isOwnerViewer: boolean;
  currentTeamId: string;
  onChange: (member: TeamMember, role: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const roleOptions = useMemo(
    () => getRoleDropdownOptions(member.user.role ?? null, isOwnerViewer),
    [member.user.role, isOwnerViewer],
  );
  const isPrimaryAdminTeam =
    member.user.role === "TEAM_ADMIN" &&
    member.user.primaryTeamId === currentTeamId;
  const displayRole = isPrimaryAdminTeam ? "TEAM_ADMIN" : member.role;
  const currentValue = isPrimaryAdminTeam ? "TEAM_ADMIN" : member.role;

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`[data-member-role="${member.id}"]`)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", closeOnOutsideClick);
    return () => document.removeEventListener("click", closeOnOutsideClick);
  }, [member.id]);

  return (
    <div className="relative" data-member-role={member.id}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        className={`inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm ${
          disabled
            ? "cursor-not-allowed bg-accent"
            : "bg-card hover:bg-accent"
        }`}
      >
        <RoleBadge role={displayRole} />
        {!disabled ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : null}
      </button>
      {open && !disabled ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border border-border bg-card shadow-lg">
          {roleOptions.map((roleValue) => (
            <button
              key={`${member.id}-${roleValue}`}
              type="button"
              onClick={() => {
                setOpen(false);
                onChange(member, roleValue);
              }}
              className={`block w-full px-4 py-2 text-left text-sm hover:bg-accent ${
                currentValue === roleValue ? "bg-blue-50" : ""
              }`}
            >
              <RoleBadge role={roleValue} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MemberSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-5 w-32 rounded skeleton-shimmer" />
          <div className="h-4 w-48 rounded skeleton-shimmer" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-8 w-24 rounded skeleton-shimmer" />
          <div className="h-8 w-20 rounded skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}

export function TeamPage({
  teamsList,
  role,
  onTeamsChanged,
}: {
  teamsList: TeamRef[];
  role: Role;
  /** Called after a team is created/edited/(de)activated so the app can refetch teams. */
  onTeamsChanged?: () => void | Promise<void>;
}) {
  const location = useLocation();
  const headerCtx = useHeaderContext();
  const { notifyTicketAggregatesChanged } = useTicketDataInvalidation();
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  const [allUsers, setAllUsers] = useState<UserRef[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("AGENT");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const usersRequestSeqRef = useRef(0);
  const membersRequestSeqRef = useRef(0);
  const inactiveRequestSeqRef = useRef(0);

  const [inactiveUsers, setInactiveUsers] = useState<UserRef[]>([]);
  const [loadingInactive, setLoadingInactive] = useState(false);
  const [deactivateTarget, setDeactivateTarget] =
    useState<DeactivationTarget | null>(null);
  const [deactivatePreview, setDeactivatePreview] =
    useState<DeactivationPreview | null>(null);
  const [deactivateConfirmEmail, setDeactivateConfirmEmail] = useState("");
  const [deactivateLoading, setDeactivateLoading] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  // Team create/edit modal + deactivated-teams management (owner only)
  const [teamForm, setTeamForm] = useState<TeamFormState | null>(null);
  const [teamFormLoading, setTeamFormLoading] = useState(false);
  const [teamFormError, setTeamFormError] = useState<string | null>(null);
  const [inactiveTeams, setInactiveTeams] = useState<TeamRef[]>([]);
  const [loadingInactiveTeams, setLoadingInactiveTeams] = useState(false);
  const [confirmDeactivateTeam, setConfirmDeactivateTeam] =
    useState<TeamRef | null>(null);
  const [confirmRemoveMember, setConfirmRemoveMember] =
    useState<TeamMember | null>(null);

  const isAdmin = role === "OWNER" || role === "TEAM_ADMIN";
  const isOwner = role === "OWNER";
  const isReadOnly = role === "LEAD";
  const viewingInactive = selectedTeamId === INACTIVE_USERS_SENTINEL;
  const viewingInactiveTeams = selectedTeamId === INACTIVE_TEAMS_SENTINEL;
  const selectedTeam =
    teamsList.find((t) => t.id === selectedTeamId) ?? null;
  const requestedTeamId =
    (
      location.state as {
        selectedTeamId?: string;
      } | null
    )?.selectedTeamId ?? null;

  useEffect(() => {
    function closeDropdowns(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-team-dropdown]")) setShowTeamDropdown(false);
      if (!target?.closest("[data-user-dropdown]")) setShowUserDropdown(false);
      if (!target?.closest("[data-add-role-dropdown]"))
        setShowRoleDropdown(false);
    }
    document.addEventListener("click", closeDropdowns);
    return () => document.removeEventListener("click", closeDropdowns);
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setAllUsers([]);
      setSelectedUserId("");
      return;
    }
    void loadUsers();
  }, [headerCtx?.currentEmail, isAdmin]);

  // Auto-select department for Lead and Team Admin (API returns only their team)
  useEffect(() => {
    if (
      (role === "LEAD" || role === "TEAM_ADMIN") &&
      teamsList.length === 1 &&
      teamsList[0].id
    ) {
      setSelectedTeamId(teamsList[0].id);
    }
  }, [role, teamsList]);

  useEffect(() => {
    if (!requestedTeamId) {
      return;
    }
    const hasRequestedTeam = teamsList.some((team) => team.id === requestedTeamId);
    if (!hasRequestedTeam) {
      return;
    }
    setSelectedTeamId((current) =>
      current === requestedTeamId ? current : requestedTeamId,
    );
  }, [requestedTeamId, teamsList]);

  useEffect(() => {
    if (!selectedTeamId) {
      setMembers([]);
      return;
    }
    if (selectedTeamId === INACTIVE_USERS_SENTINEL) {
      setMembers([]);
      void loadInactiveUsers();
      return;
    }
    if (selectedTeamId === INACTIVE_TEAMS_SENTINEL) {
      setMembers([]);
      void loadInactiveTeams();
      return;
    }
    void loadMembers(selectedTeamId);
  }, [selectedTeamId]);

  useEffect(() => {
    if (
      !selectedTeamId ||
      selectedTeamId === INACTIVE_USERS_SENTINEL ||
      selectedTeamId === INACTIVE_TEAMS_SENTINEL
    )
      return;
    const stillExists = teamsList.some((team) => team.id === selectedTeamId);
    if (!stillExists) {
      setSelectedTeamId("");
      setMembers([]);
    }
  }, [selectedTeamId, teamsList]);

  useEffect(() => {
    setSelectedUserId("");
    setSelectedRole("AGENT");
    setShowUserDropdown(false);
    setShowRoleDropdown(false);
    setActionError(null);
  }, [selectedTeamId]);

  useEffect(() => {
    const handleAdminChanged = (event: Event) => {
      const payload = (event as CustomEvent<RealtimeAdminChangedEventPayload>)
        .detail;
      const scope = payload?.scope;
      if (scope !== "team" && scope !== "team_member") {
        return;
      }
      if (isAdmin) {
        void loadUsers();
      }
      if (
        selectedTeamId &&
        selectedTeamId !== INACTIVE_USERS_SENTINEL &&
        selectedTeamId !== INACTIVE_TEAMS_SENTINEL
      ) {
        void loadMembers(selectedTeamId);
      }
    };

    window.addEventListener(
      REALTIME_ADMIN_CHANGED_EVENT,
      handleAdminChanged as EventListener,
    );
    return () =>
      window.removeEventListener(
        REALTIME_ADMIN_CHANGED_EVENT,
        handleAdminChanged as EventListener,
      );
  }, [isAdmin, selectedTeamId]);

  const showDepartmentDropdown = isOwner;

  async function loadUsers() {
    const requestSeq = ++usersRequestSeqRef.current;
    setLoadingUsers(true);
    setActionError(null);
    try {
      const response = await fetchAllUsers();
      if (usersRequestSeqRef.current !== requestSeq) return;
      setAllUsers(response.data);
    } catch {
      if (usersRequestSeqRef.current !== requestSeq) return;
      setActionError("Unable to load users.");
    } finally {
      if (usersRequestSeqRef.current !== requestSeq) return;
      setLoadingUsers(false);
    }
  }

  async function loadMembers(teamId: string) {
    const requestSeq = ++membersRequestSeqRef.current;
    setLoadingMembers(true);
    setMemberError(null);
    try {
      const response = await fetchTeamMembers(teamId);
      if (membersRequestSeqRef.current !== requestSeq) return;
      setMembers(response.data);
    } catch {
      if (membersRequestSeqRef.current !== requestSeq) return;
      setMemberError("Unable to load team members.");
      setMembers([]);
    } finally {
      if (membersRequestSeqRef.current !== requestSeq) return;
      setLoadingMembers(false);
    }
  }

  async function loadInactiveUsers() {
    const requestSeq = ++inactiveRequestSeqRef.current;
    setLoadingInactive(true);
    setMemberError(null);
    try {
      const response = await fetchAllUsers({ status: "inactive" });
      if (inactiveRequestSeqRef.current !== requestSeq) return;
      setInactiveUsers(response.data);
    } catch {
      if (inactiveRequestSeqRef.current !== requestSeq) return;
      setMemberError("Unable to load inactive users.");
      setInactiveUsers([]);
    } finally {
      if (inactiveRequestSeqRef.current !== requestSeq) return;
      setLoadingInactive(false);
    }
  }

  async function openDeactivateModal(target: DeactivationTarget) {
    setDeactivateTarget(target);
    setDeactivatePreview(null);
    setDeactivateConfirmEmail("");
    setDeactivateError(null);
    try {
      const preview = await previewUserDeactivation(target.userId);
      setDeactivatePreview({
        ticketsOpen: preview.ticketsOpen,
        teams: preview.teams,
      });
    } catch {
      setDeactivateError("Unable to load deactivation details.");
    }
  }

  function closeDeactivateModal() {
    setDeactivateTarget(null);
    setDeactivatePreview(null);
    setDeactivateConfirmEmail("");
    setDeactivateError(null);
    setDeactivateLoading(false);
  }

  async function handleConfirmDeactivate() {
    if (!deactivateTarget) return;
    if (
      deactivateConfirmEmail.trim().toLowerCase() !==
      deactivateTarget.email.toLowerCase()
    ) {
      setDeactivateError("Email confirmation does not match.");
      return;
    }
    setDeactivateLoading(true);
    setDeactivateError(null);
    const targetUserId = deactivateTarget.userId;
    try {
      await deactivateUser(targetUserId);
      // Optimistic update: drop the row immediately so the user sees the change.
      setMembers((prev) =>
        prev.filter((member) => member.user.id !== targetUserId),
      );
      setAllUsers((prev) => prev.filter((user) => user.id !== targetUserId));
      // Refresh sidebar saved-view counts (Unassigned, etc.) since the
      // backend just bulk-set assigneeId=null on this user's open tickets.
      notifyTicketAggregatesChanged();
      closeDeactivateModal();
    } catch {
      setDeactivateError("Unable to deactivate user.");
      setDeactivateLoading(false);
    }
  }

  async function handleReactivate(userId: string) {
    if (deactivateLoading) return;
    setDeactivateLoading(true);
    setMemberError(null);
    try {
      await reactivateUser(userId);
      setInactiveUsers((prev) => prev.filter((u) => u.id !== userId));
      await loadUsers();
    } catch {
      setMemberError("Unable to reactivate user.");
    } finally {
      setDeactivateLoading(false);
    }
  }

  async function handleAddMember() {
    if (
      !selectedTeamId ||
      !selectedUserId ||
      actionLoading ||
      !availableUsers.some((user) => user.id === selectedUserId)
    ) {
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await addTeamMember(selectedTeamId, {
        userId: selectedUserId,
        role: selectedRole,
      });
      setSelectedUserId("");
      setSelectedRole("AGENT");
      await loadMembers(selectedTeamId);
    } catch {
      setActionError("Unable to add team member.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRoleChange(member: TeamMember, roleValue: string) {
    if (!selectedTeamId || actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    try {
      if (roleValue === "TEAM_ADMIN") {
        // Promote global user role + set this team as their primary admin team,
        // then promote their team-member role to ADMIN.
        await updateUserRole(member.user.id, {
          role: "TEAM_ADMIN",
          primaryTeamId: selectedTeamId,
        });
        await updateTeamMember(selectedTeamId, member.id, { role: "ADMIN" });
        await loadMembers(selectedTeamId);
        return;
      }
      // Switching away from TEAM_ADMIN: demote global role first.
      if (
        member.user.role === "TEAM_ADMIN" &&
        member.user.primaryTeamId === selectedTeamId
      ) {
        await updateUserRole(member.user.id, {
          role: roleValue === "LEAD" ? "LEAD" : "AGENT",
          primaryTeamId: null,
        });
      }
      await updateTeamMember(selectedTeamId, member.id, { role: roleValue });
      await loadMembers(selectedTeamId);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Unable to update member role.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSetPrimaryTeam(member: TeamMember) {
    if (!selectedTeamId || actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await setUserPrimaryTeam(member.user.id, selectedTeamId);
      setMembers((prev) =>
        prev.map((item) =>
          item.user.id === member.user.id
            ? {
                ...item,
                user: { ...item.user, primaryTeamId: selectedTeamId },
              }
            : item,
        ),
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Unable to set primary team.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRemove(member: TeamMember) {
    if (!selectedTeamId || actionLoading) return;
    setConfirmRemoveMember(null);
    setActionLoading(true);
    setActionError(null);
    try {
      await removeTeamMember(selectedTeamId, member.id);
      setMembers((prev) => prev.filter((item) => item.id !== member.id));
    } catch {
      setActionError("Unable to remove team member.");
    } finally {
      setActionLoading(false);
    }
  }

  /* ——— Team create / edit / (de)activate (owner only) ——— */

  function openCreateTeam() {
    setTeamFormError(null);
    setTeamForm({
      mode: "create",
      name: "",
      description: "",
      assignmentStrategy: "QUEUE_ONLY",
    });
  }

  function openEditTeam(team: TeamRef) {
    setTeamFormError(null);
    setTeamForm({
      mode: "edit",
      teamId: team.id,
      name: team.name,
      description: team.description ?? "",
      assignmentStrategy: team.assignmentStrategy ?? "QUEUE_ONLY",
    });
  }

  async function submitTeamForm() {
    if (!teamForm) return;
    const name = teamForm.name.trim();
    if (!name) {
      setTeamFormError("Department name is required.");
      return;
    }
    setTeamFormLoading(true);
    setTeamFormError(null);
    try {
      if (teamForm.mode === "create") {
        const created = await createTeam({
          name,
          description: teamForm.description.trim() || undefined,
          assignmentStrategy: teamForm.assignmentStrategy,
        });
        // Wait for the teams list to refresh before selecting, so the
        // "still exists" guard doesn't deselect the brand-new team.
        await onTeamsChanged?.();
        setTeamForm(null);
        if (created?.id) setSelectedTeamId(created.id);
      } else if (teamForm.teamId) {
        await updateTeam(teamForm.teamId, {
          name,
          description: teamForm.description.trim(),
          assignmentStrategy: teamForm.assignmentStrategy,
        });
        onTeamsChanged?.();
        setTeamForm(null);
      }
    } catch (err) {
      setTeamFormError(
        err instanceof Error ? err.message : "Unable to save department.",
      );
    } finally {
      setTeamFormLoading(false);
    }
  }

  async function setTeamActive(team: TeamRef, isActive: boolean) {
    if (actionLoading) return;
    setConfirmDeactivateTeam(null);
    setActionLoading(true);
    setActionError(null);
    try {
      await updateTeam(team.id, { isActive });
      onTeamsChanged?.();
      if (!isActive && selectedTeamId === team.id) setSelectedTeamId("");
      if (viewingInactiveTeams) void loadInactiveTeams();
    } catch {
      setActionError(
        isActive
          ? "Unable to reactivate department."
          : "Unable to deactivate department.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function loadInactiveTeams() {
    setLoadingInactiveTeams(true);
    try {
      const res = await fetchAllTeamsAdmin();
      setInactiveTeams(res.data.filter((t) => t.isActive === false));
    } catch {
      setInactiveTeams([]);
    } finally {
      setLoadingInactiveTeams(false);
    }
  }

  const eligibleUsers = useMemo(() => {
    if (!isAdmin) return [];
    return allUsers.filter(
      (user) => !user.role || ELIGIBLE_MEMBER_USER_ROLES.has(user.role),
    );
  }, [allUsers, isAdmin]);

  const availableUsers = useMemo(() => {
    if (!isAdmin) return [];
    const memberUserIds = new Set(members.map((member) => member.user.id));
    return eligibleUsers.filter((user) => !memberUserIds.has(user.id));
  }, [eligibleUsers, isAdmin, members]);

  useEffect(() => {
    if (
      selectedUserId &&
      !availableUsers.some((user) => user.id === selectedUserId)
    ) {
      setSelectedUserId("");
    }
  }, [availableUsers, selectedUserId]);

  const selectedUser =
    availableUsers.find((user) => user.id === selectedUserId) ?? null;
  const addRoleOptions = useMemo(
    () => getRoleDropdownOptions(selectedUser?.role ?? null, isOwner).filter(
      (r) => r !== "TEAM_ADMIN",
    ),
    [selectedUser?.role, isOwner],
  );
  const canAddSelectedUser =
    selectedUserId.length > 0 &&
    availableUsers.some((user) => user.id === selectedUserId);
  const userSelectionLabel = selectedUser
    ? selectedUser.displayName
    : loadingUsers
      ? "Loading users..."
      : availableUsers.length > 0
        ? "Select user"
        : eligibleUsers.length === 0
          ? "No eligible users available"
          : "All eligible users are already members";

  useEffect(() => {
    if (!addRoleOptions.includes(selectedRole)) {
      setSelectedRole(addRoleOptions[0] ?? "AGENT");
    }
  }, [addRoleOptions, selectedRole]);

  return (
    <section className="min-h-full bg-background animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-none px-6 py-4">
          {headerCtx ? (
            <TopBar
              title={headerCtx.title}
              subtitle={headerCtx.subtitle}
              currentEmail={headerCtx.currentEmail}
              onOpenSearch={headerCtx.onOpenSearch}
              notificationProps={headerCtx.notificationProps}
              leftContent={
                <div>
                  <h1 className="text-xl font-semibold text-foreground">
                    Team Directory
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    View and manage team membership
                  </p>
                </div>
              }
            />
          ) : (
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Team Directory
              </h1>
              <p className="text-sm text-muted-foreground">
                View and manage team membership
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-none px-6 py-6">
        <div className="glass-card w-full rounded-xl p-6 shadow-sm">
          <div className="mb-6">
            {isReadOnly ? (
              <div className="mb-4">
                <span className="rounded-lg bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700">
                  Read-only access
                </span>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              {showDepartmentDropdown ? (
                <div
                  className="relative w-full max-w-md flex-1"
                  data-team-dropdown
                >
                  <button
                    type="button"
                    onClick={() => setShowTeamDropdown((prev) => !prev)}
                    className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted"
                  >
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-muted-foreground" />
                      <span className="text-foreground">
                        {viewingInactive
                          ? "Inactive users"
                          : viewingInactiveTeams
                            ? "Inactive departments"
                            : selectedTeam
                              ? selectedTeam.name
                              : "Select department"}
                      </span>
                    </div>
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  </button>
                  {showTeamDropdown ? (
                    <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-border bg-card shadow-lg">
                      {teamsList.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => {
                            setSelectedTeamId(team.id);
                            setMemberError(null);
                            setShowTeamDropdown(false);
                          }}
                          className={`block w-full px-4 py-2 text-left text-sm hover:bg-accent ${
                            selectedTeamId === team.id
                              ? "bg-blue-50 text-blue-700"
                              : "text-foreground"
                          }`}
                        >
                          {team.name}
                        </button>
                      ))}
                      {isOwner ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTeamId(INACTIVE_USERS_SENTINEL);
                            setMemberError(null);
                            setShowTeamDropdown(false);
                          }}
                          className={`block w-full border-t border-border px-4 py-2 text-left text-sm hover:bg-accent ${
                            viewingInactive
                              ? "bg-blue-50 text-blue-700"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span className="inline-flex items-center gap-2">
                            <UserMinus className="h-4 w-4" />
                            Inactive users
                          </span>
                        </button>
                      ) : null}
                      {isOwner ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTeamId(INACTIVE_TEAMS_SENTINEL);
                            setMemberError(null);
                            setShowTeamDropdown(false);
                          }}
                          className={`block w-full border-t border-border px-4 py-2 text-left text-sm hover:bg-accent ${
                            viewingInactiveTeams
                              ? "bg-blue-50 text-blue-700"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span className="inline-flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            Inactive departments
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-4 py-2.5 text-sm text-foreground">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <span>
                    {selectedTeam ? selectedTeam.name : "Select a department"}
                  </span>
                </div>
              )}
              {isOwner ? (
                <button
                  type="button"
                  onClick={openCreateTeam}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  <UserPlus className="h-4 w-4" />
                  New Department
                </button>
              ) : null}
              {isOwner &&
              selectedTeam &&
              !viewingInactive &&
              !viewingInactiveTeams ? (
                <>
                  <button
                    type="button"
                    onClick={() => openEditTeam(selectedTeam)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeactivateTeam(selectedTeam)}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Deactivate
                  </button>
                </>
              ) : null}
              {memberError ? (
                <div className="inline-flex items-center gap-1 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4" />
                  <span>{memberError}</span>
                </div>
              ) : null}
            </div>
          </div>

          {teamsList.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                No departments yet
              </h3>
              <p className="text-sm text-muted-foreground">
                {isOwner
                  ? "Create a department to start adding members."
                  : "No departments available. Contact an owner to create departments."}
              </p>
            </div>
          ) : null}

          {teamsList.length > 0 && !selectedTeamId ? (
            <div className="py-12 text-center">
              <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                Select a department
              </h3>
              <p className="text-sm text-muted-foreground">
                Choose a team to view members and manage access.
              </p>
            </div>
          ) : null}

          {selectedTeamId && !viewingInactive && !viewingInactiveTeams ? (
            <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">
                    Members
                  </h3>
                  {loadingMembers ? (
                    <span className="text-sm text-muted-foreground">Loading...</span>
                  ) : null}
                </div>
                <div className="space-y-3">
                  {loadingMembers ? (
                    <>
                      <MemberSkeleton />
                      <MemberSkeleton />
                      <MemberSkeleton />
                    </>
                  ) : null}

                  {!loadingMembers && members.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-border bg-muted py-8 text-center">
                      <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        No members found.
                      </p>
                    </div>
                  ) : null}

                  {!loadingMembers
                    ? members.map((member) => (
                        <div
                          key={member.id}
                          className="rounded-xl border border-border bg-card p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                                {member.user.displayName
                                  .split(" ")
                                  .map((chunk) => chunk[0] ?? "")
                                  .slice(0, 2)
                                  .join("")
                                  .toUpperCase()}
                              </div>
                              <div>
                                {isOwner ? (
                                  <a
                                    href={`/admin/agents/${member.user.id}`}
                                    className="text-sm font-semibold text-foreground hover:underline"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      window.location.href = `/admin/agents/${member.user.id}`;
                                    }}
                                  >
                                    {member.user.displayName}
                                  </a>
                                ) : (
                                  <h4 className="text-sm font-semibold text-foreground">
                                    {member.user.displayName}
                                  </h4>
                                )}
                                <p className="text-sm text-muted-foreground">
                                  {member.user.email}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <MemberRoleDropdown
                                member={member}
                                disabled={isReadOnly || actionLoading}
                                isOwnerViewer={isOwner}
                                currentTeamId={selectedTeamId}
                                onChange={handleRoleChange}
                              />
                              {isOwner &&
                              member.user.role === "TEAM_ADMIN" &&
                              member.user.primaryTeamId !== selectedTeamId ? (
                                <button
                                  type="button"
                                  onClick={() => void handleSetPrimaryTeam(member)}
                                  disabled={actionLoading}
                                  title="Retarget this user's primary admin team to the team currently being viewed."
                                  className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Make this their primary team
                                </button>
                              ) : null}
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => setConfirmRemoveMember(member)}
                                  disabled={actionLoading}
                                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Remove
                                </button>
                              ) : null}
                              {isOwner ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void openDeactivateModal({
                                      userId: member.user.id,
                                      displayName: member.user.displayName,
                                      email: member.user.email,
                                    })
                                  }
                                  disabled={actionLoading || deactivateLoading}
                                  title="Deactivate user (off-board)"
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-500 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <UserMinus className="h-4 w-4" />
                                  Deactivate
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))
                    : null}
                </div>
              </div>

              <div>
                <div className="rounded-xl border border-border bg-muted p-6">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">
                    Add member
                  </h3>
                  <p className="mb-4 text-sm text-muted-foreground">
                    {isReadOnly
                      ? "Admin access is required to manage memberships."
                      : "Invite an existing user to this team."}
                  </p>

                  {isReadOnly ? (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                      <div className="flex items-start gap-3">
                        <ShieldAlert className="mt-0.5 h-5 w-5 text-yellow-600" />
                        <div>
                          <p className="text-sm font-medium text-yellow-800">
                            Read-only access
                          </p>
                          <p className="mt-1 text-sm text-yellow-700">
                            You can view team members but cannot add, remove, or
                            change roles. Contact a Team Admin or Owner for
                            help.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-foreground">
                          User
                        </label>
                        <div className="relative" data-user-dropdown>
                          <button
                            type="button"
                            disabled={actionLoading || loadingUsers}
                            onClick={() => setShowUserDropdown((prev) => !prev)}
                            className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:bg-accent"
                          >
                            <span className="text-foreground">
                              {userSelectionLabel}
                            </span>
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          </button>

                          {showUserDropdown && availableUsers.length > 0 ? (
                            <div className="absolute left-0 top-full z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                              {availableUsers.map((user) => (
                                <button
                                  key={user.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedUserId(user.id);
                                    setShowUserDropdown(false);
                                  }}
                                  className="block w-full px-4 py-2 text-left text-sm hover:bg-accent"
                                >
                                  <div className="font-medium text-foreground">
                                    {user.displayName}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {user.email}
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-foreground">
                          Role
                        </label>
                        <div className="relative" data-add-role-dropdown>
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => setShowRoleDropdown((prev) => !prev)}
                            className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:bg-accent"
                          >
                            <RoleBadge role={selectedRole} />
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          </button>
                          {showRoleDropdown ? (
                            <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-border bg-card shadow-lg">
                              {addRoleOptions.map((roleValue) => (
                                <button
                                  key={`new-member-${roleValue}`}
                                  type="button"
                                  onClick={() => {
                                    setSelectedRole(roleValue);
                                    setShowRoleDropdown(false);
                                  }}
                                  className="block w-full px-4 py-2 text-left text-sm hover:bg-accent"
                                >
                                  <RoleBadge role={roleValue} />
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleAddMember()}
                        disabled={
                          !canAddSelectedUser || actionLoading || loadingUsers
                        }
                        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
                      >
                        {actionLoading ? "Adding..." : "Add member"}
                      </button>

                      {actionError ? (
                        <div className="inline-flex items-center gap-1 text-sm text-red-600">
                          <AlertCircle className="h-4 w-4" />
                          <span>{actionError}</span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {viewingInactive ? (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  Inactive users
                </h3>
                {loadingInactive ? (
                  <span className="text-sm text-muted-foreground">
                    Loading...
                  </span>
                ) : null}
              </div>
              <div className="space-y-3">
                {loadingInactive ? (
                  <>
                    <MemberSkeleton />
                    <MemberSkeleton />
                  </>
                ) : null}

                {!loadingInactive && inactiveUsers.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-border bg-muted py-8 text-center">
                    <UserMinus className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No inactive users.
                    </p>
                  </div>
                ) : null}

                {!loadingInactive
                  ? inactiveUsers.map((user) => (
                      <div
                        key={user.id}
                        className="rounded-xl border border-border bg-card p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                              {user.displayName
                                .split(" ")
                                .map((chunk) => chunk[0] ?? "")
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()}
                            </div>
                            <div>
                              <h4 className="text-sm font-semibold text-foreground">
                                {user.displayName}
                              </h4>
                              <p className="text-sm text-muted-foreground">
                                {user.email}
                              </p>
                              {user.deactivatedAt ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Deactivated{" "}
                                  {new Date(
                                    user.deactivatedAt,
                                  ).toLocaleDateString()}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleReactivate(user.id)}
                            disabled={deactivateLoading}
                            className="inline-flex items-center gap-1 rounded-lg border border-green-500 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <UserPlus className="h-4 w-4" />
                            Reactivate
                          </button>
                        </div>
                      </div>
                    ))
                  : null}
              </div>
            </div>
          ) : null}

          {viewingInactiveTeams ? (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  Inactive departments
                </h3>
                {loadingInactiveTeams ? (
                  <span className="text-sm text-muted-foreground">
                    Loading...
                  </span>
                ) : null}
              </div>
              <div className="space-y-3">
                {!loadingInactiveTeams && inactiveTeams.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-border bg-muted py-8 text-center">
                    <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No inactive departments.
                    </p>
                  </div>
                ) : null}
                {!loadingInactiveTeams
                  ? inactiveTeams.map((team) => (
                      <div
                        key={team.id}
                        className="rounded-xl border border-border bg-card p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold text-foreground">
                              {team.name}
                            </h4>
                            {team.description ? (
                              <p className="text-sm text-muted-foreground">
                                {team.description}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => void setTeamActive(team, true)}
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1 rounded-lg border border-green-500 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <UserPlus className="h-4 w-4" />
                            Reactivate
                          </button>
                        </div>
                      </div>
                    ))
                  : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {teamForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">
                {teamForm.mode === "create"
                  ? "New Department"
                  : "Edit Department"}
              </h2>
              <button
                type="button"
                onClick={() => setTeamForm(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-accent"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={teamForm.name}
                  onChange={(e) =>
                    setTeamForm((f) => (f ? { ...f, name: e.target.value } : f))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitTeamForm();
                  }}
                  placeholder="e.g. Facilities"
                  maxLength={80}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Description{" "}
                  <span className="font-normal">(helps AI routing)</span>
                </label>
                <textarea
                  value={teamForm.description}
                  onChange={(e) =>
                    setTeamForm((f) =>
                      f ? { ...f, description: e.target.value } : f,
                    )
                  }
                  rows={2}
                  placeholder="What kinds of requests this team handles…"
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Assignment strategy
                </label>
                <select
                  value={teamForm.assignmentStrategy}
                  onChange={(e) =>
                    setTeamForm((f) =>
                      f ? { ...f, assignmentStrategy: e.target.value } : f,
                    )
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  {ASSIGNMENT_STRATEGY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {teamFormError ? (
              <p className="mt-3 text-sm text-red-600">{teamFormError}</p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTeamForm(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitTeamForm()}
                disabled={teamFormLoading || !teamForm.name.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {teamFormLoading
                  ? "Saving…"
                  : teamForm.mode === "create"
                    ? "Create"
                    : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={!!confirmDeactivateTeam}
        destructive
        title="Deactivate department?"
        confirmLabel="Deactivate"
        message={
          <>
            <span className="font-medium text-foreground">
              {confirmDeactivateTeam?.name}
            </span>{" "}
            will stop receiving new tickets and AI routing, and disappear from
            active lists. You can reactivate it later.
          </>
        }
        loading={actionLoading}
        onConfirm={() => {
          if (confirmDeactivateTeam)
            void setTeamActive(confirmDeactivateTeam, false);
        }}
        onCancel={() => setConfirmDeactivateTeam(null)}
      />

      <ConfirmDialog
        open={!!confirmRemoveMember}
        destructive
        title="Remove member?"
        confirmLabel="Remove"
        message={
          <>
            Remove{" "}
            <span className="font-medium text-foreground">
              {confirmRemoveMember?.user.displayName}
            </span>{" "}
            from {selectedTeam?.name ?? "this team"}?
          </>
        }
        loading={actionLoading}
        onConfirm={() => {
          if (confirmRemoveMember) void handleRemove(confirmRemoveMember);
        }}
        onCancel={() => setConfirmRemoveMember(null)}
      />

      {deactivateTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Deactivate {deactivateTarget.displayName}?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {deactivateTarget.email}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDeactivateModal}
                className="rounded-lg p-1 text-muted-foreground hover:bg-accent"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {deactivatePreview ? (
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    {deactivatePreview.ticketsOpen === 0
                      ? "No open tickets to unassign."
                      : `Unassigns ${deactivatePreview.ticketsOpen} open ticket${
                          deactivatePreview.ticketsOpen === 1 ? "" : "s"
                        } (they'll move to the team queue as NEW).`}
                  </li>
                  <li>
                    {deactivatePreview.teams.length === 0
                      ? "Not a member of any teams."
                      : `Removes from ${deactivatePreview.teams.length} team${
                          deactivatePreview.teams.length === 1 ? "" : "s"
                        }: ${deactivatePreview.teams.join(", ")}.`}
                  </li>
                  <li>Hides them from assignee dropdowns.</li>
                  <li>
                    Past ticket history will still show their name.
                  </li>
                </ul>
              ) : (
                <p>Loading impact summary...</p>
              )}
            </div>

            <label className="mb-2 block text-sm font-medium text-foreground">
              Type their email to confirm
            </label>
            <input
              type="email"
              value={deactivateConfirmEmail}
              onChange={(e) => {
                setDeactivateConfirmEmail(e.target.value);
                if (deactivateError) setDeactivateError(null);
              }}
              placeholder={deactivateTarget.email}
              className="mb-3 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />

            {deactivateError ? (
              <div className="mb-3 inline-flex items-center gap-1 text-sm text-red-600">
                <AlertCircle className="h-4 w-4" />
                <span>{deactivateError}</span>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDeactivateModal}
                disabled={deactivateLoading}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeactivate()}
                disabled={
                  deactivateLoading ||
                  !deactivatePreview ||
                  deactivateConfirmEmail.trim().toLowerCase() !==
                    deactivateTarget.email.toLowerCase()
                }
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deactivateLoading ? "Deactivating..." : "Deactivate user"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
