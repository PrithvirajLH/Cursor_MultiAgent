import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Ticket,
  Users,
  LayoutDashboard,
  Settings,
  Clock,
  BarChart3,
  FolderKanban,
  ClipboardList,
  ListChecks,
  Plus,
  X,
  ArrowRight,
  History
} from 'lucide-react';
import { searchAll, type SearchResults } from '../api/client';
import type { RecentSearch } from '../hooks/useCommandPalette';
import { formatTicketId } from '../utils/format';

type CommandPaletteProps = {
  isOpen: boolean;
  onClose: () => void;
  recentSearches: RecentSearch[];
  onSearch: (query: string) => void;
  onClearRecent: () => void;
  onCreateTicket: () => void;
  currentRole: string;
};

type PageResult = {
  key: string;
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  roles: string[];
};

const PAGES: PageResult[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ['EMPLOYEE', 'AGENT', 'LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'tickets', label: 'All Tickets', path: '/tickets', icon: Ticket, roles: ['AGENT', 'LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'triage', label: 'Triage Board', path: '/triage', icon: ClipboardList, roles: ['LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'manager', label: 'Manager Views', path: '/manager', icon: FolderKanban, roles: ['LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'team', label: 'Team Management', path: '/team', icon: Users, roles: ['LEAD', 'TEAM_ADMIN', 'OWNER'] },
  { key: 'sla', label: 'SLA Settings', path: '/sla-settings', icon: Clock, roles: ['TEAM_ADMIN', 'OWNER'] },
  { key: 'reports', label: 'Reports', path: '/reports', icon: BarChart3, roles: ['TEAM_ADMIN', 'OWNER'] },
  { key: 'admin', label: 'Admin Settings', path: '/admin', icon: Settings, roles: ['TEAM_ADMIN', 'OWNER'] },
  { key: 'routing', label: 'Routing Rules', path: '/routing', icon: Settings, roles: ['TEAM_ADMIN', 'OWNER'] },
  { key: 'categories', label: 'Categories', path: '/categories', icon: FolderKanban, roles: ['OWNER'] },
  { key: 'custom-fields', label: 'Custom Fields', path: '/custom-fields', icon: ListChecks, roles: ['TEAM_ADMIN', 'OWNER'] },
  { key: 'audit-log', label: 'Audit Log', path: '/audit-log', icon: History, roles: ['TEAM_ADMIN', 'OWNER'] }
];

const ACTIONS = [
  { key: 'new-ticket', label: 'Create New Ticket', icon: Plus, action: 'createTicket' }
];

export function CommandPalette({
  isOpen,
  onClose,
  recentSearches,
  onSearch,
  onClearRecent,
  onCreateTicket,
  currentRole
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter pages by role
  const availablePages = useMemo(
    () => PAGES.filter((page) => page.roles.includes(currentRole)),
    [currentRole]
  );

  // Filter pages by query
  const filteredPages = useMemo(() => {
    if (!query.trim()) return availablePages.slice(0, 4);
    const lowered = query.toLowerCase();
    return availablePages.filter((page) =>
      page.label.toLowerCase().includes(lowered) || page.key.includes(lowered)
    );
  }, [query, availablePages]);

  // Filter actions by query
  const filteredActions = useMemo(() => {
    if (!query.trim()) return ACTIONS;
    const lowered = query.toLowerCase();
    return ACTIONS.filter((action) => action.label.toLowerCase().includes(lowered));
  }, [query]);

  // Build flat list of all results for keyboard navigation
  const allResults = useMemo(() => {
    const items: Array<{ type: string; data: unknown; id: string }> = [];

    // Recent searches (only when no query)
    if (!query.trim() && recentSearches.length > 0) {
      recentSearches.forEach((search) => {
        items.push({ type: 'recent', data: search, id: `recent-${search.query}` });
      });
    }

    // Actions
    filteredActions.forEach((action) => {
      items.push({ type: 'action', data: action, id: `action-${action.key}` });
    });

    // Pages
    filteredPages.forEach((page) => {
      items.push({ type: 'page', data: page, id: `page-${page.key}` });
    });

    // Tickets from search
    if (results?.tickets) {
      results.tickets.forEach((ticket) => {
        items.push({ type: 'ticket', data: ticket, id: `ticket-${ticket.id}` });
      });
    }

    // Users from search
    if (results?.users) {
      results.users.forEach((user) => {
        items.push({ type: 'user', data: user, id: `user-${user.id}` });
      });
    }

    // Teams from search
    if (results?.teams) {
      results.teams.forEach((team) => {
        items.push({ type: 'team', data: team, id: `team-${team.id}` });
      });
    }

    return items;
  }, [query, recentSearches, filteredActions, filteredPages, results]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults(null);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced search with AbortController to prevent stale results
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults(null);
      return;
    }

    const abortController = new AbortController();

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const searchResults = await searchAll(query, abortController.signal);
        // Only update results if request wasn't aborted
        if (!abortController.signal.aborted) {
          setResults(searchResults);
        }
      } catch (error) {
        // Ignore abort errors, only clear results for real errors
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        if (!abortController.signal.aborted) {
          setResults(null);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [query]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [allResults.length]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Handle item selection
  const handleSelect = useCallback(
    (item: { type: string; data: unknown }) => {
      switch (item.type) {
        case 'recent': {
          const search = item.data as RecentSearch;
          setQuery(search.query);
          break;
        }
        case 'action': {
          const action = item.data as (typeof ACTIONS)[0];
          if (action.action === 'createTicket') {
            onClose();
            onCreateTicket();
          }
          break;
        }
        case 'page': {
          const page = item.data as PageResult;
          onClose();
          navigate(page.path);
          break;
        }
        case 'ticket': {
          const ticket = item.data as SearchResults['tickets'][0];
          onSearch(query);
          onClose();
          navigate(`/tickets/${ticket.id}`);
          break;
        }
        case 'user': {
          // For now, just close - could navigate to user profile in future
          onClose();
          break;
        }
        case 'team': {
          onClose();
          navigate('/team');
          break;
        }
      }
    },
    [navigate, onClose, onCreateTicket, onSearch, query]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, allResults.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          if (allResults[selectedIndex]) {
            handleSelect(allResults[selectedIndex]);
          }
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
      }
    },
    [allResults, selectedIndex, handleSelect, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-slate-900/50 backdrop-blur-sm">
      <div
        className="glass-card-strong w-full max-w-2xl overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search Header */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <Search className="h-5 w-5 text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-lg text-slate-900 placeholder:text-slate-400 focus:outline-none"
            placeholder="Search tickets, navigate, or type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search"
          />
          {loading && (
            <div className="h-5 w-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results List */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto p-2">
          {/* Recent Searches */}
          {!query.trim() && recentSearches.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Recent Searches
                </span>
                <button
                  type="button"
                  onClick={onClearRecent}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Clear
                </button>
              </div>
              {recentSearches.map((search, index) => {
                const itemIndex = index;
                const isSelected = selectedIndex === itemIndex;
                return (
                  <button
                    key={search.query}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => handleSelect({ type: 'recent', data: search })}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition ${
                      isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <History className="h-4 w-4 text-slate-400" />
                    <span className="flex-1 text-sm text-slate-700">{search.query}</span>
                    <ArrowRight className="h-4 w-4 text-slate-300" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Actions */}
          {filteredActions.length > 0 && (
            <div className="mb-2">
              <div className="px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Actions
                </span>
              </div>
              {filteredActions.map((action) => {
                const itemIndex = allResults.findIndex((r) => r.id === `action-${action.key}`);
                const isSelected = selectedIndex === itemIndex;
                const Icon = action.icon;
                return (
                  <button
                    key={action.key}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => handleSelect({ type: 'action', data: action })}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition ${
                      isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="h-8 w-8 rounded-lg bg-slate-900 flex items-center justify-center">
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <span className="flex-1 text-sm font-medium text-slate-900">{action.label}</span>
                    <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">
                      Alt + N
                    </kbd>
                  </button>
                );
              })}
            </div>
          )}

          {/* Pages */}
          {filteredPages.length > 0 && (
            <div className="mb-2">
              <div className="px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Pages
                </span>
              </div>
              {filteredPages.map((page) => {
                const itemIndex = allResults.findIndex((r) => r.id === `page-${page.key}`);
                const isSelected = selectedIndex === itemIndex;
                const Icon = page.icon;
                return (
                  <button
                    key={page.key}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => handleSelect({ type: 'page', data: page })}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition ${
                      isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center">
                      <Icon className="h-4 w-4 text-slate-600" />
                    </div>
                    <span className="flex-1 text-sm text-slate-700">{page.label}</span>
                    <ArrowRight className="h-4 w-4 text-slate-300" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Ticket Results */}
          {results?.tickets && results.tickets.length > 0 && (
            <div className="mb-2">
              <div className="px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Tickets
                </span>
              </div>
              {results.tickets.map((ticket) => {
                const itemIndex = allResults.findIndex((r) => r.id === `ticket-${ticket.id}`);
                const isSelected = selectedIndex === itemIndex;
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => handleSelect({ type: 'ticket', data: ticket })}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition ${
                      isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Ticket className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{ticket.subject}</p>
                      <p className="text-xs text-slate-500">
                        {formatTicketId(ticket)} · {ticket.status} · {ticket.assignedTeam?.name ?? 'Unassigned'}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      ticket.priority === 'P1' ? 'bg-red-100 text-red-700' :
                      ticket.priority === 'P2' ? 'bg-amber-100 text-amber-700' :
                      ticket.priority === 'P3' ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {ticket.priority}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* User Results */}
          {results?.users && results.users.length > 0 && (
            <div className="mb-2">
              <div className="px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Users
                </span>
              </div>
              {results.users.map((user) => {
                const itemIndex = allResults.findIndex((r) => r.id === `user-${user.id}`);
                const isSelected = selectedIndex === itemIndex;
                return (
                  <button
                    key={user.id}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => handleSelect({ type: 'user', data: user })}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition ${
                      isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white text-xs font-semibold">
                      {user.displayName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{user.displayName}</p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Team Results */}
          {results?.teams && results.teams.length > 0 && (
            <div className="mb-2">
              <div className="px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Teams
                </span>
              </div>
              {results.teams.map((team) => {
                const itemIndex = allResults.findIndex((r) => r.id === `team-${team.id}`);
                const isSelected = selectedIndex === itemIndex;
                return (
                  <button
                    key={team.id}
                    type="button"
                    data-selected={isSelected}
                    onClick={() => handleSelect({ type: 'team', data: team })}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition ${
                      isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <Users className="h-4 w-4 text-emerald-600" />
                    </div>
                    <span className="flex-1 text-sm text-slate-700">{team.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* No Results */}
          {query.trim().length >= 2 && !loading && !results?.tickets?.length && !results?.users?.length && !results?.teams?.length && filteredPages.length === 0 && filteredActions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Search className="h-10 w-10 text-slate-300 mb-3" />
              <p className="text-sm">No results found for "{query}"</p>
              <p className="text-xs text-slate-400 mt-1">Try a different search term</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-4 py-2 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">↑</kbd>
              <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">↓</kbd>
              to navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">↵</kbd>
              to select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">esc</kbd>
              to close
            </span>
          </div>
          <span className="hidden sm:inline">
            <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">⌘</kbd> +{' '}
            <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">K</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
