import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ShieldAlert, Users } from 'lucide-react';
import {
  addTeamMember,
  fetchAllUsers,
  fetchTeamMembers,
  removeTeamMember,
  updateTeamMember,
  type NotificationRecord,
  type TeamMember,
  type TeamRef,
  type UserRef
} from '../api/client';
import { TopBar } from '../components/TopBar';
import type { Role } from '../types';

const ELIGIBLE_MEMBER_USER_ROLES = new Set(['EMPLOYEE', 'AGENT', 'LEAD', 'TEAM_ADMIN', 'ADMIN']);

function getAllowedTeamRolesForUser(userRole?: string | null): string[] {
  if (userRole === 'TEAM_ADMIN' || userRole === 'ADMIN') {
    return ['ADMIN'];
  }
  if (userRole === 'EMPLOYEE') {
    return ['AGENT'];
  }
  return ['AGENT', 'LEAD'];
}

type TeamHeaderProps = {
  title: string;
  subtitle: string;
  currentEmail: string;
  personas: { label: string; email: string }[];
  onEmailChange: (email: string) => void;
  onOpenSearch?: () => void;
  notificationProps?: {
    notifications: NotificationRecord[];
    unreadCount: number;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    onMarkAsRead: (id: string) => void;
    onMarkAllAsRead: () => void;
    onRefresh: () => void;
  };
};

function RoleBadge({ role }: { role: string }) {
  const tone =
    role === 'ADMIN'
      ? 'bg-orange-100 text-orange-700'
      : role === 'LEAD'
        ? 'bg-purple-100 text-purple-700'
        : 'bg-blue-100 text-blue-700';
  return <span className={`rounded-lg px-2 py-1 text-xs font-medium ${tone}`}>{role}</span>;
}

function MemberRoleDropdown({
  member,
  disabled,
  onChange
}: {
  member: TeamMember;
  disabled: boolean;
  onChange: (member: TeamMember, role: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const roleOptions = useMemo(
    () => getAllowedTeamRolesForUser(member.user.role ?? null),
    [member.user.role]
  );

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`[data-member-role="${member.id}"]`)) {
        setOpen(false);
      }
    }
    document.addEventListener('click', closeOnOutsideClick);
    return () => document.removeEventListener('click', closeOnOutsideClick);
  }, [member.id]);

  return (
    <div className="relative" data-member-role={member.id}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        className={`inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm ${
          disabled ? 'cursor-not-allowed bg-slate-100' : 'bg-white hover:bg-slate-50'
        }`}
      >
        <RoleBadge role={member.role} />
        {!disabled ? <ChevronDown className="h-4 w-4 text-slate-500" /> : null}
      </button>
      {open && !disabled ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-32 rounded-lg border border-slate-200 bg-white shadow-lg">
          {roleOptions.map((roleValue) => (
            <button
              key={`${member.id}-${roleValue}`}
              type="button"
              onClick={() => {
                setOpen(false);
                onChange(member, roleValue);
              }}
              className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-100 ${
                member.role === roleValue ? 'bg-blue-50' : ''
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
    <div className="rounded-xl border border-slate-200 bg-white p-4">
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
  refreshKey,
  teamsList,
  role,
  headerProps
}: {
  refreshKey: number;
  teamsList: TeamRef[];
  role: Role;
  headerProps?: TeamHeaderProps;
}) {
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  const [allUsers, setAllUsers] = useState<UserRef[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('AGENT');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [showTeamDropdown, setShowTeamDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const usersRequestSeqRef = useRef(0);
  const membersRequestSeqRef = useRef(0);

  const isAdmin = role === 'OWNER' || role === 'TEAM_ADMIN';
  const isOwner = role === 'OWNER';
  const isReadOnly = role === 'LEAD';

  useEffect(() => {
    function closeDropdowns(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-team-dropdown]')) setShowTeamDropdown(false);
      if (!target?.closest('[data-user-dropdown]')) setShowUserDropdown(false);
      if (!target?.closest('[data-add-role-dropdown]')) setShowRoleDropdown(false);
    }
    document.addEventListener('click', closeDropdowns);
    return () => document.removeEventListener('click', closeDropdowns);
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setAllUsers([]);
      setSelectedUserId('');
      return;
    }
    void loadUsers();
  }, [headerProps?.currentEmail, isAdmin]);

  // Auto-select department for Lead and Team Admin (API returns only their team)
  useEffect(() => {
    if ((role === 'LEAD' || role === 'TEAM_ADMIN') && teamsList.length === 1 && teamsList[0].id) {
      setSelectedTeamId(teamsList[0].id);
    }
  }, [role, teamsList]);

  useEffect(() => {
    if (!selectedTeamId) {
      setMembers([]);
      return;
    }
    void loadMembers(selectedTeamId);
  }, [selectedTeamId, refreshKey]);

  useEffect(() => {
    if (!selectedTeamId) return;
    const stillExists = teamsList.some((team) => team.id === selectedTeamId);
    if (!stillExists) {
      setSelectedTeamId('');
      setMembers([]);
    }
  }, [selectedTeamId, teamsList]);

  useEffect(() => {
    setSelectedUserId('');
    setSelectedRole('AGENT');
    setShowUserDropdown(false);
    setShowRoleDropdown(false);
    setActionError(null);
  }, [selectedTeamId]);

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
      setActionError('Unable to load users.');
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
      setMemberError('Unable to load team members.');
      setMembers([]);
    } finally {
      if (membersRequestSeqRef.current !== requestSeq) return;
      setLoadingMembers(false);
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
      await addTeamMember(selectedTeamId, { userId: selectedUserId, role: selectedRole });
      setSelectedUserId('');
      setSelectedRole('AGENT');
      await loadMembers(selectedTeamId);
    } catch {
      setActionError('Unable to add team member.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRoleChange(member: TeamMember, roleValue: string) {
    if (!selectedTeamId || actionLoading) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await updateTeamMember(selectedTeamId, member.id, { role: roleValue });
      setMembers((prev) =>
        prev.map((item) => (item.id === member.id ? { ...item, role: roleValue } : item))
      );
    } catch {
      setActionError('Unable to update member role.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRemove(member: TeamMember) {
    if (!selectedTeamId || actionLoading) return;
    const confirmed = window.confirm(
      `Remove ${member.user.displayName} from ${teamsList.find((team) => team.id === selectedTeamId)?.name ?? 'this team'}?`
    );
    if (!confirmed) return;

    setActionLoading(true);
    setActionError(null);
    try {
      await removeTeamMember(selectedTeamId, member.id);
      setMembers((prev) => prev.filter((item) => item.id !== member.id));
    } catch {
      setActionError('Unable to remove team member.');
    } finally {
      setActionLoading(false);
    }
  }

  const eligibleUsers = useMemo(() => {
    if (!isAdmin) return [];
    return allUsers.filter((user) => !user.role || ELIGIBLE_MEMBER_USER_ROLES.has(user.role));
  }, [allUsers, isAdmin]);

  const availableUsers = useMemo(() => {
    if (!isAdmin) return [];
    const memberUserIds = new Set(members.map((member) => member.user.id));
    return eligibleUsers.filter((user) => !memberUserIds.has(user.id));
  }, [eligibleUsers, isAdmin, members]);

  useEffect(() => {
    if (selectedUserId && !availableUsers.some((user) => user.id === selectedUserId)) {
      setSelectedUserId('');
    }
  }, [availableUsers, selectedUserId]);

  const selectedTeam = teamsList.find((team) => team.id === selectedTeamId) ?? null;
  const selectedUser = availableUsers.find((user) => user.id === selectedUserId) ?? null;
  const addRoleOptions = useMemo(
    () => getAllowedTeamRolesForUser(selectedUser?.role ?? null),
    [selectedUser?.role]
  );
  const canAddSelectedUser = selectedUserId.length > 0 && availableUsers.some((user) => user.id === selectedUserId);
  const userSelectionLabel = selectedUser
    ? selectedUser.displayName
    : loadingUsers
      ? 'Loading users...'
      : availableUsers.length > 0
        ? 'Select user'
        : eligibleUsers.length === 0
          ? 'No eligible users available'
          : 'All eligible users are already members';

  useEffect(() => {
    if (!addRoleOptions.includes(selectedRole)) {
      setSelectedRole(addRoleOptions[0] ?? 'AGENT');
    }
  }, [addRoleOptions, selectedRole]);

  return (
    <section className="min-h-full bg-slate-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1600px] pl-6 pr-2 py-4">
          {headerProps ? (
            <TopBar
              title={headerProps.title}
              subtitle={headerProps.subtitle}
              currentEmail={headerProps.currentEmail}
              personas={headerProps.personas}
              onEmailChange={headerProps.onEmailChange}
              onOpenSearch={headerProps.onOpenSearch}
              notificationProps={headerProps.notificationProps}
              leftContent={
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">Team Directory</h1>
                  <p className="text-sm text-slate-500">View and manage team membership</p>
                </div>
              }
            />
          ) : (
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Team Directory</h1>
              <p className="text-sm text-slate-500">View and manage team membership</p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1600px] px-6 py-6">
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
                <div className="relative w-full max-w-md flex-1" data-team-dropdown>
                  <button
                    type="button"
                    onClick={() => setShowTeamDropdown((prev) => !prev)}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-4 py-2.5 text-sm hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-slate-400" />
                      <span className="text-slate-700">
                        {selectedTeam ? selectedTeam.name : 'Select department'}
                      </span>
                    </div>
                    <ChevronDown className="h-5 w-5 text-slate-400" />
                  </button>
                  {showTeamDropdown ? (
                    <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                      {teamsList.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => {
                            setSelectedTeamId(team.id);
                            setMemberError(null);
                            setShowTeamDropdown(false);
                          }}
                          className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-100 ${
                            selectedTeamId === team.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                          }`}
                        >
                          {team.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700">
                  <Users className="h-5 w-5 text-slate-400" />
                  <span>{selectedTeam ? selectedTeam.name : 'Select a department'}</span>
                </div>
              )}
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
              <Users className="mx-auto mb-4 h-12 w-12 text-slate-400" />
              <h3 className="mb-2 text-lg font-semibold text-slate-900">No departments yet</h3>
              <p className="text-sm text-slate-500">
                {isOwner
                  ? 'Create a department to start adding members.'
                  : 'No departments available. Contact an owner to create departments.'}
              </p>
            </div>
          ) : null}

          {teamsList.length > 0 && !selectedTeamId ? (
            <div className="py-12 text-center">
              <Users className="mx-auto mb-4 h-12 w-12 text-slate-400" />
              <h3 className="mb-2 text-lg font-semibold text-slate-900">Select a department</h3>
              <p className="text-sm text-slate-500">Choose a team to view members and manage access.</p>
            </div>
          ) : null}

          {selectedTeamId ? (
            <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Members</h3>
                  {loadingMembers ? <span className="text-sm text-slate-500">Loading...</span> : null}
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
                    <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 py-8 text-center">
                      <Users className="mx-auto mb-3 h-10 w-10 text-slate-400" />
                      <p className="text-sm text-slate-500">No members found.</p>
                    </div>
                  ) : null}

                  {!loadingMembers
                    ? members.map((member) => (
                        <div key={member.id} className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                                {member.user.displayName
                                  .split(' ')
                                  .map((chunk) => chunk[0] ?? '')
                                  .slice(0, 2)
                                  .join('')
                                  .toUpperCase()}
                              </div>
                              <div>
                                <h4 className="text-sm font-semibold text-slate-900">{member.user.displayName}</h4>
                                <p className="text-sm text-slate-500">{member.user.email}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <MemberRoleDropdown
                                member={member}
                                disabled={isReadOnly || actionLoading}
                                onChange={handleRoleChange}
                              />
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRemove(member)}
                                  disabled={actionLoading}
                                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Remove
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
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">Add member</h3>
                  <p className="mb-4 text-sm text-slate-500">
                    {isReadOnly
                      ? 'Admin access is required to manage memberships.'
                      : 'Invite an existing user to this team.'}
                  </p>

                  {isReadOnly ? (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                      <div className="flex items-start gap-3">
                        <ShieldAlert className="mt-0.5 h-5 w-5 text-yellow-600" />
                        <div>
                          <p className="text-sm font-medium text-yellow-800">Read-only access</p>
                          <p className="mt-1 text-sm text-yellow-700">
                            You can view team members but cannot add, remove, or change roles. Contact a Team Admin
                            or Owner for help.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-700">User</label>
                        <div className="relative" data-user-dropdown>
                          <button
                            type="button"
                            disabled={actionLoading || loadingUsers}
                            onClick={() => setShowUserDropdown((prev) => !prev)}
                            className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
                          >
                            <span className="text-slate-700">{userSelectionLabel}</span>
                            <ChevronDown className="h-4 w-4 text-slate-500" />
                          </button>

                          {showUserDropdown && availableUsers.length > 0 ? (
                            <div className="absolute left-0 top-full z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                              {availableUsers.map((user) => (
                                <button
                                  key={user.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedUserId(user.id);
                                    setShowUserDropdown(false);
                                  }}
                                  className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-100"
                                >
                                  <div className="font-medium text-slate-900">{user.displayName}</div>
                                  <div className="text-xs text-slate-500">{user.email}</div>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-700">Role</label>
                        <div className="relative" data-add-role-dropdown>
                          <button
                            type="button"
                            disabled={actionLoading}
                            onClick={() => setShowRoleDropdown((prev) => !prev)}
                            className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
                          >
                            <RoleBadge role={selectedRole} />
                            <ChevronDown className="h-4 w-4 text-slate-500" />
                          </button>
                          {showRoleDropdown ? (
                            <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                              {addRoleOptions.map((roleValue) => (
                                <button
                                  key={`new-member-${roleValue}`}
                                  type="button"
                                  onClick={() => {
                                    setSelectedRole(roleValue);
                                    setShowRoleDropdown(false);
                                  }}
                                  className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-100"
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
                        disabled={!canAddSelectedUser || actionLoading || loadingUsers}
                        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {actionLoading ? 'Adding...' : 'Add member'}
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
        </div>
      </div>
    </section>
  );
}

