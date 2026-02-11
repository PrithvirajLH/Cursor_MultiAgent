# Enterprise UI/UX Improvement Tasks

> A comprehensive task list to transform the Codex Ticketing System into an enterprise-grade, user-friendly application.

**Status (updated 2026-02-09):** Phase 1 complete. Phase 2 tasks 2.1-2.5 complete; 2.6 (Related/Linked Tickets) pending. Phase 3 tasks 3.1 (Custom Fields), 3.2 (Reporting), 3.3 (Automation Rules), and 3.4 (Audit Log page) complete. Phase 4 (Polish & Accessibility) pending.
Canonical planning/status source: `docs/unified-status-and-backlog-2026-02-09.md`.

---

## Table of Contents

1. [Phase 1: Quick Wins](#phase-1-quick-wins)
2. [Phase 2: Core Improvements](#phase-2-core-improvements)
3. [Phase 3: Enterprise Features](#phase-3-enterprise-features)
4. [Phase 4: Polish & Accessibility](#phase-4-polish--accessibility)

---

## Phase 1: Quick Wins

High-impact improvements that can be implemented quickly.

---

### Task 1.1: Global Search / Command Palette

**Priority:** High  
**Complexity:** Medium  
**Estimated Components:** 2-3 new components

#### Description
Add a keyboard-accessible command palette (similar to VS Code's Ctrl+Shift+P or Slack's Ctrl+K) that allows users to quickly navigate, search, and perform actions from anywhere in the application.

#### Requirements

1. **Trigger Methods:**
   - Keyboard shortcut: `Cmd/Ctrl + K`
   - Click on search icon in TopBar

2. **Search Capabilities:**
   - Search tickets by ID, subject, or requester name
   - Search users/agents by name or email
   - Search teams/departments
   - Search navigation items (pages)
   - Search actions (e.g., "Create ticket", "View reports")

3. **UI Elements:**
   - Modal overlay with backdrop blur
   - Search input with auto-focus
   - Categorized results (Tickets, Users, Pages, Actions)
   - Keyboard navigation (arrow keys + Enter)
   - Recent searches section
   - Loading state while searching

4. **Behavior:**
   - Debounced search (300ms delay)
   - Escape key to close
   - Click outside to close
   - Show "No results" state

#### Files to Create/Modify

```
apps/web/src/components/CommandPalette.tsx (new)
apps/web/src/hooks/useCommandPalette.ts (new)
apps/web/src/App.tsx (add keyboard listener)
apps/web/src/api/client.ts (update search behavior to use existing ticket/user/team endpoints)
```

#### API Endpoint / Data Source

```typescript
No dedicated /api/search endpoint in current implementation.
Command palette uses:
- GET /api/tickets?q=...
- GET /api/users
- GET /api/teams
with client-side grouping/caching for fast lookup.
```

#### Acceptance Criteria

- [x] Cmd/Ctrl + K opens the command palette from any page
- [x] Users can search and navigate to tickets by ID or subject
- [x] Users can search and view user profiles
- [x] Recent searches are persisted in localStorage
- [x] Results are categorized and keyboard-navigable
- [x] Search is debounced and shows loading state

---

### Task 1.2: Notification Center

**Priority:** High  
**Complexity:** Medium  
**Estimated Components:** 3-4 new components

#### Description
Add a notification bell icon in the TopBar that shows real-time notifications for ticket updates, SLA warnings, mentions, and assignments.

#### Requirements

1. **Notification Types:**
   - Ticket assigned to you
   - Ticket you're following was updated
   - New message on your ticket
   - SLA breach warning (approaching deadline)
   - SLA breached
   - Mentioned in internal note (@username)
   - Ticket transferred to your team

2. **UI Elements:**
   - Bell icon with unread count badge (red dot or number)
   - Dropdown panel with notification list
   - Each notification shows: icon, title, description, timestamp
   - Mark as read (individual and "mark all as read")
   - Click notification to navigate to relevant ticket
   - Empty state when no notifications

3. **Notification Panel Layout:**
   ```
   ┌─────────────────────────────────────┐
   │ Notifications            Mark all ✓ │
   ├─────────────────────────────────────┤
   │ 🎫 Ticket IT-1234 assigned to you   │
   │    Password reset issue · 5m ago    │
   ├─────────────────────────────────────┤
   │ 💬 New reply on IT-1230             │
   │    Jane Doe replied · 1h ago        │
   ├─────────────────────────────────────┤
   │ ⚠️ SLA at risk: IT-1228             │
   │    2 hours until breach · 2h ago    │
   └─────────────────────────────────────┘
   ```

4. **Backend Requirements:**
   - Store notifications in database
   - API to fetch notifications (paginated)
   - API to mark as read
   - WebSocket or polling for real-time updates (start with polling)

#### Files to Create/Modify

```
apps/web/src/components/NotificationCenter.tsx (new)
apps/web/src/components/NotificationItem.tsx (new)
apps/web/src/hooks/useNotifications.ts (new)
apps/web/src/components/TopBar.tsx (add bell icon)
apps/api/src/notifications/notifications.controller.ts (add endpoints)
apps/api/prisma/schema.prisma (add Notification model if not exists)
```

#### Database Schema Addition

```prisma
model Notification {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  type        String   // TICKET_ASSIGNED, NEW_MESSAGE, SLA_WARNING, etc.
  title       String
  body        String?
  ticketId    String?
  ticket      Ticket?  @relation(fields: [ticketId], references: [id])
  isRead      Boolean  @default(false)
  createdAt   DateTime @default(now())
}
```

#### API Endpoints

```typescript
GET /api/notifications?page=1&pageSize=20
Response: { data: Notification[], meta: { total, unreadCount } }

PATCH /api/notifications/:id/read
PATCH /api/notifications/read-all
```

#### Acceptance Criteria

- [x] Bell icon visible in TopBar with unread count badge
- [x] Clicking bell opens notification dropdown
- [x] Notifications are fetched on page load
- [x] Click notification navigates to relevant ticket
- [x] Mark individual notification as read
- [x] Mark all notifications as read
- [x] Notifications refresh every 30 seconds (polling)
- [x] Empty state shown when no notifications

---

### Task 1.3: Bulk Actions Toolbar

**Priority:** High  
**Complexity:** Medium  
**Estimated Components:** 2 new components

#### Description
Add the ability to select multiple tickets and perform bulk actions like assign, change status, or transfer.

#### Requirements

1. **Selection UI:**
   - Checkbox on each ticket row/card
   - "Select all" checkbox in header
   - Selected count indicator: "3 tickets selected"
   - Clear selection button

2. **Bulk Actions Available:**
   - Assign to agent (dropdown)
   - Change status (dropdown)
   - Change priority (dropdown)
   - Transfer to team (dropdown)
   - Add followers
   - Export selected (CSV)

3. **Toolbar Layout:**
   ```
   ┌──────────────────────────────────────────────────────────────┐
   │ ☑ 5 selected    [Assign ▼] [Status ▼] [Transfer ▼] [× Clear] │
   └──────────────────────────────────────────────────────────────┘
   ```

4. **Behavior:**
   - Toolbar appears when 1+ tickets selected
   - Toolbar is sticky at top of ticket list
   - Confirmation dialog for destructive actions
   - Toast notification on success/failure
   - Refresh list after bulk action

#### Files to Create/Modify

```
apps/web/src/components/BulkActionsToolbar.tsx (new)
apps/web/src/hooks/useTicketSelection.ts (new)
apps/web/src/pages/TicketsPage.tsx (add selection state and toolbar)
apps/api/src/tickets/tickets.controller.ts (add bulk endpoints)
apps/api/src/tickets/dto/bulk-action.dto.ts (new)
```

#### API Endpoints

```typescript
POST /api/tickets/bulk/assign
Body: { ticketIds: string[], assigneeId: string }

POST /api/tickets/bulk/status
Body: { ticketIds: string[], status: string }

POST /api/tickets/bulk/transfer
Body: { ticketIds: string[], teamId: string }

POST /api/tickets/bulk/priority
Body: { ticketIds: string[], priority: string }
```

#### Acceptance Criteria

- [x] Checkboxes appear on ticket list items
- [x] Select all checkbox selects visible tickets
- [x] Bulk toolbar appears when tickets selected
- [x] Bulk assign works and refreshes list
- [x] Bulk status change works with valid transitions only
- [x] Bulk transfer works
- [x] Confirmation dialog shown before action
- [x] Clear selection button works
- [x] Toast shown on success/error

---

### Task 1.4: Keyboard Shortcuts

**Priority:** Medium  
**Complexity:** Low  
**Estimated Components:** 1 new hook

#### Description
Implement keyboard shortcuts throughout the application for power users.

#### Requirements

1. **Global Shortcuts:**
   | Shortcut | Action | Context |
   |----------|--------|---------|
   | `Cmd/Ctrl + K` | Open command palette | Global |
   | `Cmd/Ctrl + N` | Open new ticket modal | Global |
   | `Cmd/Ctrl + /` | Focus search input | Global |
   | `?` | Show keyboard shortcuts help | Global |

2. **Ticket List Shortcuts:**
   | Shortcut | Action |
   |----------|--------|
   | `J` | Move to next ticket |
   | `K` | Move to previous ticket |
   | `Enter` | Open selected ticket |
   | `X` | Toggle selection |
   | `Shift + X` | Select range |

3. **Ticket Detail Shortcuts:**
   | Shortcut | Action |
   |----------|--------|
   | `R` | Focus reply textarea |
   | `A` | Assign to me |
   | `S` | Open status dropdown |
   | `Escape` | Close modal / Go back |

4. **Help Modal:**
   - Triggered by `?` key
   - Shows all available shortcuts for current context
   - Grouped by category

#### Files to Create/Modify

```
apps/web/src/hooks/useKeyboardShortcuts.ts (new)
apps/web/src/components/KeyboardShortcutsHelp.tsx (new)
apps/web/src/App.tsx (add global listeners)
apps/web/src/pages/TicketsPage.tsx (add list navigation)
apps/web/src/pages/TicketDetailPage.tsx (add detail shortcuts)
```

#### Acceptance Criteria

- [x] Cmd/Ctrl + K opens command palette
- [x] Cmd/Ctrl + N opens new ticket modal
- [x] J/K navigates ticket list with visual focus indicator
- [x] Enter opens focused ticket
- [x] `?` shows help modal with all shortcuts
- [x] Shortcuts don't fire when typing in input/textarea
- [x] Shortcuts are context-aware (different on list vs detail)

---

### Task 1.5: Ticket Count Badges on Sidebar

**Priority:** Medium  
**Complexity:** Low  
**Estimated Components:** 0 (modify existing)

#### Description
Show ticket count badges next to relevant sidebar items to give users visibility into queue sizes.

#### Requirements

1. **Badges to Show:**
   - "Assigned to Me" - count of open tickets assigned to current user
   - "Triage Board" - count of NEW/unassigned tickets
   - "All Tickets" - total open tickets (optional)

2. **UI:**
   ```
   📋 Assigned to Me      (12)
   📥 Triage Board        (5)
   ```

3. **Behavior:**
   - Badges update on ticket list refresh
   - Don't show badge if count is 0
   - Badge has subtle background (e.g., slate-200)

#### Files to Create/Modify

```
apps/web/src/components/Sidebar.tsx (add badge prop and rendering)
apps/web/src/App.tsx (fetch counts and pass to Sidebar)
apps/api/src/tickets/tickets.controller.ts (add counts endpoint)
```

#### API Endpoint

```typescript
GET /api/tickets/counts
Response: {
  assignedToMe: number,
  triage: number,
  open: number
}
```

#### Acceptance Criteria

- [x] Badge shows next to "Assigned to Me" with correct count
- [x] Badge shows next to "Triage Board" with NEW ticket count
- [x] Badges update when tickets change
- [x] Badge hidden when count is 0
- [x] Works in both expanded and collapsed sidebar states

---

### Task 1.6: Copy Ticket Link Button

**Priority:** Low  
**Complexity:** Low  
**Estimated Components:** 0 (modify existing)

#### Description
Add a "Copy link" button on the ticket detail page for easy sharing.

#### Requirements

1. **Button Location:** Near ticket ID in header
2. **Behavior:**
   - Click copies full URL to clipboard
   - Show toast: "Link copied to clipboard"
   - Button shows checkmark briefly after copy

3. **UI:**
   ```
   Ticket ID: IT-1234  [📋 Copy link]
   ```

#### Files to Create/Modify

```
apps/web/src/pages/TicketDetailPage.tsx (add copy button)
apps/web/src/utils/clipboard.ts (new - clipboard helper)
```

#### Acceptance Criteria

- [x] Copy link button visible on ticket detail page
- [x] Clicking copies the full ticket URL
- [x] Toast notification confirms copy
- [x] Button shows visual feedback (checkmark or animation)

---

### Task 1.7: Relative Timestamps with Hover

**Priority:** Low  
**Complexity:** Low  
**Estimated Components:** 1 new component

#### Description
Display timestamps as relative ("2 hours ago") with absolute time shown on hover.

#### Requirements

1. **Display Format:**
   - < 1 minute: "Just now"
   - < 60 minutes: "X minutes ago"
   - < 24 hours: "X hours ago"
   - < 7 days: "X days ago"
   - >= 7 days: "Jan 29, 2026"

2. **Hover Tooltip:**
   - Show full date and time: "January 29, 2026 at 2:45 PM"

3. **Auto-Update:**
   - Timestamps update every minute while visible

#### Files to Create/Modify

```
apps/web/src/components/RelativeTime.tsx (new)
apps/web/src/utils/format.ts (update formatDate function)
apps/web/src/pages/*.tsx (replace formatDate calls with RelativeTime component)
```

#### Acceptance Criteria

- [x] Timestamps show relative format
- [x] Hover shows absolute date/time tooltip
- [x] Format is user-friendly and consistent
- [x] Times update automatically without refresh

---

## Phase 2: Core Improvements

Significant feature enhancements requiring more development effort.

---

### Task 2.1: Advanced Filtering Panel

**Priority:** High  
**Complexity:** High  
**Estimated Components:** 4-5 new components

#### Description
Replace basic dropdowns with a comprehensive filtering panel that supports multi-select, date ranges, and saved filter views.

#### Requirements

1. **Filter Panel UI:**
   ```
   ┌─────────────────────────────────────────┐
   │ Filters                    [Clear all]  │
   ├─────────────────────────────────────────┤
   │ Status          ▼                       │
   │ ☑ New  ☑ In Progress  ☐ Waiting        │
   │ ☐ Resolved  ☐ Closed                    │
   ├─────────────────────────────────────────┤
   │ Priority        ▼                       │
   │ ☑ P1  ☑ P2  ☐ P3  ☐ P4                 │
   ├─────────────────────────────────────────┤
   │ Team            ▼                       │
   │ [Multi-select dropdown]                 │
   ├─────────────────────────────────────────┤
   │ Assignee        ▼                       │
   │ [Multi-select with search]              │
   ├─────────────────────────────────────────┤
   │ SLA Status      ▼                       │
   │ ☐ On track  ☑ At risk  ☑ Breached      │
   ├─────────────────────────────────────────┤
   │ Created Date                            │
   │ [From: ___] [To: ___]                   │
   ├─────────────────────────────────────────┤
   │ Due Date                                │
   │ [From: ___] [To: ___]                   │
   ├─────────────────────────────────────────┤
   │ [💾 Save as view]                       │
   └─────────────────────────────────────────┘
   ```

2. **Filter Types:**
   - Multi-select checkboxes: Status, Priority, SLA Status
   - Multi-select dropdown with search: Team, Assignee, Requester
   - Date range picker: Created, Updated, Due Date
   - Text search: Subject contains, Description contains

3. **Saved Views:**
   - Save current filters as named view
   - Quick access to saved views (tabs or dropdown)
   - Personal views vs shared team views
   - Edit and delete saved views

4. **URL Persistence:**
   - Filters reflected in URL query params
   - Shareable filtered URLs
   - Browser back/forward works with filters

#### Files to Create/Modify

```
apps/web/src/components/filters/FilterPanel.tsx (new)
apps/web/src/components/filters/MultiSelectFilter.tsx (new)
apps/web/src/components/filters/DateRangeFilter.tsx (new)
apps/web/src/components/filters/SavedViewsDropdown.tsx (new)
apps/web/src/hooks/useFilters.ts (new)
apps/web/src/pages/TicketsPage.tsx (integrate filter panel)
apps/api/src/tickets/dto/list-tickets.dto.ts (extend with new params)
apps/api/prisma/schema.prisma (add SavedView model)
```

#### Database Schema Addition

```prisma
model SavedView {
  id        String   @id @default(uuid())
  name      String
  filters   Json     // Stored filter configuration
  userId    String?  // null = shared view
  user      User?    @relation(fields: [userId], references: [id])
  teamId    String?  // Team-shared view
  team      Team?    @relation(fields: [teamId], references: [id])
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

#### Acceptance Criteria

- [x] Filter panel is collapsible/expandable
- [x] Multi-select works for status, priority, team
- [x] Date range picker works for created/due dates
- [x] Active filters shown as pills/tags
- [x] Clear all filters button works
- [x] Filters persist in URL
- [x] Can save current filters as named view
- [x] Can load saved views
- [x] API supports all filter parameters

---

### Task 2.2: Table View Toggle

**Priority:** Medium  
**Complexity:** Medium  
**Estimated Components:** 2 new components

#### Description
Add the ability to switch between card view (current) and a traditional table view for the ticket list.

#### Requirements

1. **Toggle UI:**
   ```
   [Grid View] [Table View]
   ```

2. **Table View Columns:**
   - Checkbox (for selection)
   - Ticket ID
   - Subject (truncated with tooltip)
   - Status
   - Priority
   - Team
   - Assignee
   - Requester
   - Created Date
   - SLA Status

3. **Table Features:**
   - Sortable columns (click header to sort)
   - Resizable columns (drag border)
   - Column visibility toggle
   - Sticky header on scroll
   - Row hover highlight
   - Click row to open ticket

4. **Persistence:**
   - Remember view preference in localStorage
   - Remember column widths and visibility

#### Files to Create/Modify

```
apps/web/src/components/TicketTableView.tsx (new)
apps/web/src/components/ViewToggle.tsx (new)
apps/web/src/hooks/useTableSettings.ts (new)
apps/web/src/pages/TicketsPage.tsx (add view toggle and table)
```

#### Acceptance Criteria

- [x] Toggle switches between card and table view
- [x] Table shows all relevant ticket data
- [x] Columns are sortable
- [x] Column widths are adjustable
- [x] View preference persists across sessions
- [x] Click row opens ticket detail
- [x] Checkboxes work for bulk selection
- [x] SLA status column shows colored badges

---

### Task 2.3: Rich Text Editor for Messages

**Priority:** Medium  
**Complexity:** Medium  
**Estimated Components:** 2 new components

#### Description
Replace the plain textarea with a rich text editor that supports formatting, mentions, and canned responses.

#### Requirements

1. **Editor Features:**
   - Bold, italic, underline
   - Bulleted and numbered lists
   - Code blocks (inline and block)
   - Links
   - @mentions with autocomplete
   - Emoji picker (optional)

2. **@Mentions:**
   - Type `@` to trigger user autocomplete
   - Search team members by name
   - Insert mention as linked text
   - Mentioned users receive notification

3. **Canned Responses:**
   - Button to insert saved response template
   - Personal and team-shared templates
   - Variables support: `{{ticket.id}}`, `{{requester.name}}`

4. **Editor behaviour:**
   - Single WYSIWYG (contentEditable) field: formatting (bold, italic, lists, etc.) is visible in the edit area; no separate preview mode or toggle is required.
   - Sent messages are rendered in the thread using the same HTML (via MessageBody).

#### Files to Create/Modify

```
apps/web/src/components/RichTextEditor.tsx (new)
apps/web/src/components/MentionAutocomplete.tsx (new)
apps/web/src/components/CannedResponsePicker.tsx (new)
apps/web/src/pages/TicketDetailPage.tsx (replace textarea)
apps/api/prisma/schema.prisma (add CannedResponse model)
apps/api/src/canned-responses/canned-responses.module.ts (new)
```

#### Database Schema Addition

```prisma
model CannedResponse {
  id        String   @id @default(uuid())
  name      String
  content   String   @db.Text
  userId    String?  // Personal template
  user      User?    @relation(fields: [userId], references: [id])
  teamId    String?  // Team template
  team      Team?    @relation(fields: [teamId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

#### Acceptance Criteria

- [x] Editor supports basic formatting (bold, italic, lists)
- [x] @mentions trigger user autocomplete
- [x] Mentioned users are notified
- [x] Canned responses can be inserted
- [x] Message renders with formatting in conversation
- [x] Works on both public replies and internal notes

---

### Task 2.4: SLA Countdown Timer Widget

**Priority:** High  
**Complexity:** Low  
**Estimated Components:** 1 new component

#### Description
Add a prominent, real-time countdown timer for SLA deadlines on the ticket detail page.

#### Requirements

1. **Timer Display:**
   ```
   ┌─────────────────────────────────┐
   │ Resolution SLA                  │
   │ ⏱ 4h 23m 15s                   │
   │ ████████████░░░░  75% remaining │
   │ Due: Jan 29, 2026 6:00 PM       │
   └─────────────────────────────────┘
   ```

2. **Visual States:**
   - **Green (>50% time):** On track
   - **Yellow (25-50%):** Caution
   - **Orange (<25%):** At risk
   - **Red (0% / negative):** Breached
   - **Gray:** Paused (with pause indicator)

3. **Features:**
   - Real-time countdown (updates every second)
   - Progress bar visualization
   - Pulsing animation when at risk
   - Show both first response and resolution SLAs
   - Pause indicator when waiting on requester/vendor

#### Files to Create/Modify

```
apps/web/src/components/SlaCountdownTimer.tsx (new)
apps/web/src/hooks/useCountdown.ts (new)
apps/web/src/pages/TicketDetailPage.tsx (add timer widget)
```

#### Acceptance Criteria

- [x] Timer counts down in real-time
- [x] Color changes based on remaining time percentage
- [x] Progress bar reflects time remaining
- [x] Shows "Paused" state correctly
- [x] Shows "Breached" state when overdue
- [x] Tooltip shows exact due date/time
- [x] Works for both first response and resolution SLAs

---

### Task 2.5: Ticket Activity Timeline

**Priority:** Medium  
**Complexity:** Medium  
**Estimated Components:** 2 new components

#### Description
Add a full activity timeline view that shows all events, not just messages.

#### Requirements

1. **Timeline Events:**
   - Ticket created
   - Status changed (from → to)
   - Priority changed
   - Assigned/reassigned
   - Team transferred
   - Message added (public/internal)
   - Attachment uploaded
   - Follower added/removed
   - SLA breached

2. **UI:**
   ```
   ┌─────────────────────────────────────────────────┐
   │ [Conversation] [Timeline]                       │
   ├─────────────────────────────────────────────────┤
   │ ● Jan 29, 2:45 PM                              │
   │   Status changed: New → In Progress            │
   │   by Alex Park                                  │
   │                                                 │
   │ ● Jan 29, 2:30 PM                              │
   │   Assigned to Alex Park                         │
   │   by Maria Chen                                 │
   │                                                 │
   │ ● Jan 29, 2:00 PM                              │
   │   Ticket created                                │
   │   by Jane Doe via Portal                        │
   └─────────────────────────────────────────────────┘
   ```

3. **Features:**
   - Toggle between conversation-only and full timeline
   - Filter timeline by event type
   - Collapsible event groups (e.g., same-day events)

#### Files to Create/Modify

```
apps/web/src/components/ActivityTimeline.tsx (new)
apps/web/src/components/TimelineEvent.tsx (new)
apps/web/src/pages/TicketDetailPage.tsx (add timeline toggle)
```

#### Acceptance Criteria

- [x] Toggle between Conversation and Timeline views
- [x] Timeline shows all event types
- [x] Events are chronologically ordered
- [x] Each event shows actor, action, and timestamp
- [x] Visual distinction between event types
- [x] Messages show inline in timeline view

---

### Task 2.6: Related/Linked Tickets

**Priority:** Medium  
**Complexity:** Medium  
**Estimated Components:** 2 new components

#### Description
Allow linking related tickets together and showing relationships on the detail page.

#### Requirements

1. **Relationship Types:**
   - Related to (general relationship)
   - Blocked by / Blocks
   - Duplicate of / Has duplicate
   - Parent / Child (sub-tickets)

2. **UI on Ticket Detail:**
   ```
   ┌─────────────────────────────────────┐
   │ Related Tickets                [+]  │
   ├─────────────────────────────────────┤
   │ 🔗 IT-1230 - Email not syncing     │
   │    Related · Open                   │
   │                                     │
   │ 🔗 IT-1228 - Calendar broken        │
   │    Duplicate of · Resolved          │
   └─────────────────────────────────────┘
   ```

3. **Add Link Modal:**
   - Search for tickets by ID or subject
   - Select relationship type
   - Bidirectional linking (linking A to B also links B to A)

4. **Merge Duplicates:**
   - Mark ticket as duplicate
   - Option to merge conversations
   - Close duplicate, keep original

#### Files to Create/Modify

```
apps/web/src/components/RelatedTickets.tsx (new)
apps/web/src/components/LinkTicketModal.tsx (new)
apps/web/src/pages/TicketDetailPage.tsx (add related section)
apps/api/prisma/schema.prisma (add TicketLink model)
apps/api/src/tickets/tickets.controller.ts (add link endpoints)
```

#### Database Schema Addition

```prisma
model TicketLink {
  id            String   @id @default(uuid())
  sourceTicketId String
  sourceTicket   Ticket   @relation("SourceLinks", fields: [sourceTicketId], references: [id])
  targetTicketId String
  targetTicket   Ticket   @relation("TargetLinks", fields: [targetTicketId], references: [id])
  linkType       String   // RELATED, BLOCKED_BY, DUPLICATE_OF, PARENT
  createdById    String
  createdBy      User     @relation(fields: [createdById], references: [id])
  createdAt      DateTime @default(now())
  
  @@unique([sourceTicketId, targetTicketId])
}
```

#### Acceptance Criteria

- [ ] Can add link to another ticket
- [ ] Can specify relationship type
- [ ] Links are bidirectional
- [ ] Related tickets shown on detail page
- [ ] Can remove links
- [ ] Can navigate to linked tickets
- [ ] Merge duplicate option available

---

## Phase 3: Enterprise Features

Advanced features for enterprise deployments.

---

### Task 3.1: Custom Fields

**Priority:** Medium  
**Complexity:** High  
**Estimated Components:** 5+ new components

#### Description
Allow administrators to define custom fields per team/category that appear on tickets.

#### Requirements

1. **Field Types:**
   - Text (single line)
   - Text Area (multi-line)
   - Number
   - Dropdown (single select)
   - Multi-select
   - Date
   - Checkbox
   - User picker

2. **Admin Configuration:**
   ```
   ┌─────────────────────────────────────────────────┐
   │ Custom Fields - IT Support                      │
   ├─────────────────────────────────────────────────┤
   │ Asset Tag       Text        Required   [Edit]   │
   │ Software        Dropdown    Optional   [Edit]   │
   │ Affected Users  Number      Optional   [Edit]   │
   │                                                  │
   │ [+ Add Custom Field]                            │
   └─────────────────────────────────────────────────┘
   ```

3. **On Ticket Form:**
   - Custom fields appear below standard fields
   - Validation based on field configuration
   - Conditional fields (show if another field = value)

4. **Filtering & Reporting:**
   - Filter by custom field values
   - Include in exports
   - Report on custom field data

#### Files to Create/Modify

```
apps/web/src/pages/CustomFieldsAdminPage.tsx (new)
apps/web/src/components/CustomFieldEditor.tsx (new)
apps/web/src/components/CustomFieldRenderer.tsx (new)
apps/web/src/components/CreateTicketModal.tsx (add custom fields)
apps/web/src/pages/TicketDetailPage.tsx (display custom fields)
apps/api/prisma/schema.prisma (add CustomField, CustomFieldValue models)
apps/api/src/custom-fields/custom-fields.module.ts (new)
```

#### Database Schema Addition

```prisma
model CustomField {
  id          String   @id @default(uuid())
  name        String
  fieldType   String   // TEXT, TEXTAREA, NUMBER, DROPDOWN, etc.
  options     Json?    // For dropdown/multiselect: [{value, label}]
  isRequired  Boolean  @default(false)
  teamId      String?  // Scope to specific team
  team        Team?    @relation(fields: [teamId], references: [id])
  categoryId  String?  // Scope to specific category
  category    Category? @relation(fields: [categoryId], references: [id])
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  values      CustomFieldValue[]
}

model CustomFieldValue {
  id            String      @id @default(uuid())
  ticketId      String
  ticket        Ticket      @relation(fields: [ticketId], references: [id])
  customFieldId String
  customField   CustomField @relation(fields: [customFieldId], references: [id])
  value         String?     @db.Text
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  
  @@unique([ticketId, customFieldId])
}
```

#### Acceptance Criteria

- [x] Admin can create custom fields
- [x] Admin can configure field type and options
- [x] Admin can set required/optional
- [x] Custom fields appear on ticket creation form
- [x] Custom fields appear on ticket detail page
- [x] Custom field values are saved and retrieved
- [x] Can filter tickets by custom field values
- [x] Custom fields included in CSV export

---

### Task 3.2: Reporting Dashboard

**Priority:** High  
**Complexity:** High  
**Estimated Components:** 6+ new components

#### Description
Build a comprehensive reporting dashboard with charts and exportable data.

#### Requirements

1. **Dashboard Layout:**
   ```
   ┌───────────────────────────────────────────────────────────┐
   │ Reports Dashboard          [Date Range: Last 30 days ▼]  │
   ├───────────────────────────────────────────────────────────┤
   │ ┌─────────────────────┐ ┌─────────────────────────────┐  │
   │ │ Ticket Volume       │ │ SLA Compliance              │  │
   │ │ [Line Chart]        │ │ [Pie Chart]                 │  │
   │ └─────────────────────┘ └─────────────────────────────┘  │
   │ ┌─────────────────────┐ ┌─────────────────────────────┐  │
   │ │ Avg Resolution Time │ │ Tickets by Priority         │  │
   │ │ [Bar Chart]         │ │ [Bar Chart]                 │  │
   │ └─────────────────────┘ └─────────────────────────────┘  │
   │ ┌─────────────────────────────────────────────────────┐  │
   │ │ Agent Performance Scorecard                         │  │
   │ │ [Table with metrics per agent]                      │  │
   │ └─────────────────────────────────────────────────────┘  │
   │                                              [Export PDF]│
   └───────────────────────────────────────────────────────────┘
   ```

2. **Report Types:**
   - **Ticket Volume:** Trend over time (line chart)
   - **SLA Compliance:** % met vs breached (pie/donut)
   - **Resolution Time:** Average by team/priority (bar)
   - **First Response Time:** Average by team (bar)
   - **Tickets by Status:** Distribution (horizontal bar)
   - **Tickets by Priority:** Distribution (bar)
   - **Agent Scorecard:** Table with metrics per agent
   - **Team Comparison:** Side-by-side team metrics

3. **Filters:**
   - Date range (preset + custom)
   - Team filter
   - Priority filter
   - Category filter

4. **Export Options:**
   - Export charts as PNG
   - Export data as CSV
   - Export full report as PDF

#### Files to Create/Modify

```
apps/web/src/pages/ReportsPage.tsx (implemented reports dashboard)
apps/web/src/components/reports/TicketVolumeChart.tsx (new)
apps/web/src/components/reports/SlaComplianceChart.tsx (new)
apps/web/src/components/reports/ResolutionTimeChart.tsx (new)
apps/web/src/components/reports/AgentScorecard.tsx (new)
apps/web/src/components/reports/ReportFilters.tsx (new)
apps/api/src/reports/reports.module.ts (new)
apps/api/src/reports/reports.controller.ts (new)
apps/api/src/reports/reports.service.ts (new)
```

#### API Endpoints

```typescript
GET /api/reports/ticket-volume?from=2026-01-01&to=2026-01-31&teamId=xxx
GET /api/reports/sla-compliance?from=...&to=...
GET /api/reports/resolution-time?from=...&to=...&groupBy=team|priority
GET /api/reports/agent-performance?from=...&to=...&teamId=xxx
```

#### Acceptance Criteria

- [x] Reports page shows all chart types
- [x] Date range filter works
- [x] Team filter works
- [x] Charts render with correct data
- [x] Agent scorecard shows per-agent metrics
- [x] Export to CSV works
- [ ] Export to PDF works (stretch goal)
- [x] Charts are responsive

---

### Task 3.3: Automation Rules Engine

**Priority:** Medium  
**Complexity:** High  
**Estimated Components:** 5+ new components

#### Description
Build a rules engine that automates ticket routing, assignment, and escalation.

#### Requirements

1. **Rule Structure:**
   - **Trigger:** When to evaluate (ticket created, status changed, SLA approaching)
   - **Conditions:** What to check (subject contains, priority is, team is)
   - **Actions:** What to do (assign to, change status, add tag, send notification)

2. **Admin UI:**
   ```
   ┌─────────────────────────────────────────────────────────┐
   │ Automation Rules                           [+ New Rule] │
   ├─────────────────────────────────────────────────────────┤
   │ Rule: Auto-assign VPN tickets                          │
   │ Trigger: Ticket Created                                │
   │ Conditions: Subject contains "VPN"                     │
   │ Actions: Assign to IT Support, Set Priority P2         │
   │ Status: ● Active                         [Edit] [Del]  │
   ├─────────────────────────────────────────────────────────┤
   │ Rule: SLA Breach Escalation                            │
   │ Trigger: SLA Breached                                  │
   │ Conditions: Priority is P1 or P2                       │
   │ Actions: Notify team lead, Change priority to P1       │
   │ Status: ● Active                         [Edit] [Del]  │
   └─────────────────────────────────────────────────────────┘
   ```

3. **Rule Builder:**
   - Visual rule builder (no coding required)
   - AND/OR condition groups
   - Test rule against existing tickets
   - Rule execution history/logs

4. **Built-in Rules:**
   - Keyword-based routing (existing)
   - SLA breach notifications
   - Auto-escalation based on time

#### Files to Create/Modify

```
apps/web/src/pages/AutomationRulesPage.tsx (new)
apps/web/src/components/automation/RuleBuilder.tsx (new)
apps/web/src/components/automation/ConditionEditor.tsx (new)
apps/web/src/components/automation/ActionEditor.tsx (new)
apps/api/prisma/schema.prisma (add AutomationRule model)
apps/api/src/automation/automation.module.ts (new)
apps/api/src/automation/automation.service.ts (new)
apps/api/src/automation/rule-engine.service.ts (new)
```

#### Database Schema Addition

```prisma
model AutomationRule {
  id          String   @id @default(uuid())
  name        String
  description String?
  trigger     String   // TICKET_CREATED, STATUS_CHANGED, SLA_APPROACHING, SLA_BREACHED
  conditions  Json     // Array of condition objects
  actions     Json     // Array of action objects
  isActive    Boolean  @default(true)
  priority    Int      @default(0)  // Execution order
  teamId      String?  // Scope to team
  team        Team?    @relation(fields: [teamId], references: [id])
  createdById String
  createdBy   User     @relation(fields: [createdById], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  executions  AutomationExecution[]
}

model AutomationExecution {
  id        String         @id @default(uuid())
  ruleId    String
  rule      AutomationRule @relation(fields: [ruleId], references: [id])
  ticketId  String
  ticket    Ticket         @relation(fields: [ticketId], references: [id])
  success   Boolean
  error     String?
  executedAt DateTime      @default(now())
}
```

#### Acceptance Criteria

- [x] Admin can create automation rules
- [x] Rule builder supports conditions and actions
- [x] Rules execute on specified triggers
- [x] Rules can be enabled/disabled
- [x] Execution history is logged
- [x] Can test rule against existing tickets
- [x] Multiple conditions with AND/OR logic

---

### Task 3.4: Audit Trail & Compliance

**Priority:** Medium  
**Complexity:** Medium  
**Estimated Components:** 2 new components

#### Description
Maintain comprehensive audit logs for compliance and troubleshooting.

#### Requirements

1. **Events to Log:**
   - All ticket changes (field changes, status, assignment)
   - Message edits/deletions
   - User login/logout
   - Permission changes
   - Configuration changes
   - Data exports

2. **Audit Log UI:**
   ```
   ┌─────────────────────────────────────────────────────────┐
   │ Audit Log                    [Export] [Date Range ▼]   │
   ├─────────────────────────────────────────────────────────┤
   │ Jan 29, 3:15 PM | Alex Park                            │
   │ Changed ticket IT-1234 status from New to In Progress  │
   ├─────────────────────────────────────────────────────────┤
   │ Jan 29, 3:10 PM | System                               │
   │ Automation rule "Auto-assign VPN" executed on IT-1234  │
   ├─────────────────────────────────────────────────────────┤
   │ Jan 29, 3:00 PM | Jane Doe                             │
   │ Created ticket IT-1234                                 │
   └─────────────────────────────────────────────────────────┘
   ```

3. **Features:**
   - Filter by user, action type, date range
   - Search audit logs
   - Export to CSV
   - Retention policy configuration

#### Files to Create/Modify

```
apps/web/src/pages/AuditLogPage.tsx (new)
apps/web/src/components/AuditLogTable.tsx (new)
apps/api/prisma/schema.prisma (add AuditLog model if not using Event)
apps/api/src/audit/audit.module.ts (new)
apps/api/src/audit/audit.service.ts (new)
apps/api/src/audit/audit.interceptor.ts (new - auto-log requests)
```

#### Acceptance Criteria

- [x] All ticket changes are logged
- [x] Audit log page shows history
- [x] Can filter by user, action, date
- [x] Can search audit logs
- [x] Can export to CSV
- [x] Logs include before/after values for changes

---

## Phase 4: Polish & Accessibility

Final polish and accessibility improvements.

---

### Task 4.1: Accessibility Improvements

**Priority:** High  
**Complexity:** Medium  
**Estimated Components:** 0 (modify existing)

#### Description
Ensure the application meets WCAG 2.1 AA accessibility standards.

#### Requirements

1. **Keyboard Navigation:**
   - All interactive elements focusable via Tab
   - Visible focus indicators (outline)
   - Skip to main content link
   - Focus trap in modals
   - Escape closes modals

2. **Screen Reader Support:**
   - ARIA labels on all buttons/icons
   - ARIA live regions for dynamic content (toasts, loading)
   - Proper heading hierarchy (h1 → h2 → h3)
   - Alt text for images
   - Form labels associated with inputs

3. **Visual Accessibility:**
   - Color contrast ratio ≥ 4.5:1
   - Don't rely solely on color (add icons/text)
   - Support prefers-reduced-motion
   - Minimum tap target size 44x44px

4. **Testing:**
   - Test with screen reader (VoiceOver, NVDA)
   - Test with keyboard only
   - Run axe accessibility checker

#### Files to Modify

```
apps/web/src/components/*.tsx (add ARIA attributes)
apps/web/src/styles.css (add focus styles, motion preferences)
apps/web/src/App.tsx (add skip link)
```

#### Acceptance Criteria

- [ ] All buttons have accessible names
- [ ] Focus visible on all interactive elements
- [ ] Modals trap focus correctly
- [ ] Screen reader announces dynamic changes
- [ ] Color contrast passes WCAG AA
- [ ] No accessibility errors in axe-core
- [ ] Keyboard-only navigation works throughout

---

### Task 4.2: Empty States & Error States

**Priority:** Medium  
**Complexity:** Low  
**Estimated Components:** 1 new component

#### Description
Add friendly, helpful empty states and error states throughout the application.

#### Requirements

1. **Empty States:**
   ```
   ┌─────────────────────────────────────────┐
   │                                         │
   │           📭                            │
   │     No tickets found                    │
   │                                         │
   │  Try adjusting your filters or          │
   │  create a new ticket to get started.    │
   │                                         │
   │        [Create Ticket]                  │
   │                                         │
   └─────────────────────────────────────────┘
   ```

2. **Error States:**
   ```
   ┌─────────────────────────────────────────┐
   │                                         │
   │           ⚠️                            │
   │    Something went wrong                 │
   │                                         │
   │  We couldn't load your tickets.         │
   │  Please try again.                      │
   │                                         │
   │      [Retry]  [Go to Dashboard]         │
   │                                         │
   └─────────────────────────────────────────┘
   ```

3. **Locations:**
   - Ticket list (no results, filter mismatch)
   - Dashboard (no recent activity)
   - Triage board (empty columns)
   - Search results (no matches)
   - Network errors
   - 404 pages

#### Files to Create/Modify

```
apps/web/src/components/EmptyState.tsx (new)
apps/web/src/components/ErrorState.tsx (new)
apps/web/src/pages/*.tsx (add empty/error states)
```

#### Acceptance Criteria

- [x] Empty states show helpful message and CTA
- [x] Error states show retry option
- [x] Consistent styling across all empty states
- [x] 404 page exists and is styled
- [x] Network errors show friendly message

---

### Task 4.3: Loading States & Skeletons

**Priority:** Medium  
**Complexity:** Low  
**Estimated Components:** 1 new component

#### Description
Ensure all loading states use skeleton loaders for better perceived performance.

#### Requirements

1. **Skeleton Components:**
   - Ticket card skeleton
   - Ticket detail skeleton
   - Dashboard stats skeleton (exists)
   - Table row skeleton
   - Avatar skeleton

2. **Loading Behavior:**
   - Show skeletons immediately (no delay)
   - Skeletons match actual content layout
   - Smooth transition from skeleton to content
   - Shimmer animation on skeletons (exists)

#### Files to Create/Modify

```
apps/web/src/components/skeletons/TicketCardSkeleton.tsx (new)
apps/web/src/components/skeletons/TableRowSkeleton.tsx (new)
apps/web/src/pages/*.tsx (ensure skeletons used everywhere)
```

#### Acceptance Criteria

- [x] All data-loading areas show skeletons
- [x] Skeletons match content dimensions
- [x] Shimmer animation works
- [x] No layout shift when content loads

---

### Task 4.4: Toast Notification System

**Priority:** Low  
**Complexity:** Low  
**Estimated Components:** 2 new components

#### Description
Create a consistent toast notification system for feedback messages.

#### Requirements

1. **Toast Types:**
   - Success (green) - Actions completed
   - Error (red) - Actions failed
   - Warning (amber) - Important notices
   - Info (blue) - General information

2. **Features:**
   - Auto-dismiss after 5 seconds
   - Manual dismiss with X button
   - Stack multiple toasts
   - Position: top-right or bottom-right
   - Accessible announcements

3. **API:**
   ```typescript
   toast.success('Ticket created successfully');
   toast.error('Failed to save changes');
   toast.warning('SLA breach approaching');
   toast.info('New ticket assigned to you');
   ```

#### Files to Create/Modify

```
apps/web/src/components/Toast.tsx (new)
apps/web/src/components/ToastContainer.tsx (new)
apps/web/src/hooks/useToast.ts (new)
apps/web/src/contexts/ToastContext.tsx (new)
apps/web/src/App.tsx (add ToastContainer)
```

#### Acceptance Criteria

- [x] Toast function available throughout app
- [x] Different styles for success/error/warning/info
- [x] Toasts auto-dismiss after timeout
- [x] Can manually dismiss toasts
- [x] Multiple toasts stack properly
- [x] Screen readers announce toast messages

---

### Task 4.5: Mobile Responsiveness

**Priority:** Medium  
**Complexity:** Medium  
**Estimated Components:** 0 (modify existing)

#### Description
Ensure the application works well on tablets and mobile devices.

#### Requirements

1. **Breakpoints:**
   - Mobile: < 640px
   - Tablet: 640px - 1024px
   - Desktop: > 1024px

2. **Mobile Adaptations:**
   - Sidebar becomes bottom navigation or hamburger menu
   - Single-column layouts
   - Larger touch targets (min 44px)
   - Simplified navigation
   - Full-width modals

3. **Tablet Adaptations:**
   - Two-column ticket detail layout
   - Collapsible sidebar
   - Adjusted card sizes

4. **Touch Interactions:**
   - Swipe gestures on ticket cards
   - Pull-to-refresh on lists
   - Long-press for context menu

#### Files to Modify

```
apps/web/src/components/Sidebar.tsx (responsive)
apps/web/src/components/MobileNav.tsx (new)
apps/web/src/pages/*.tsx (responsive layouts)
apps/web/src/styles.css (responsive utilities)
apps/web/tailwind.config.ts (breakpoint config)
```

#### Acceptance Criteria

- [ ] App usable on mobile devices
- [ ] Navigation accessible on all screen sizes
- [ ] Forms are mobile-friendly
- [ ] Touch targets are appropriately sized
- [ ] No horizontal scrolling on mobile
- [ ] Modals work on small screens

---

## Summary & Prioritization

### High Priority (Do First)
1. Task 1.1: Global Search / Command Palette
2. Task 1.2: Notification Center
3. Task 1.3: Bulk Actions Toolbar
4. Task 2.1: Advanced Filtering Panel
5. Task 2.4: SLA Countdown Timer Widget
6. Task 3.2: Reporting Dashboard
7. Task 4.1: Accessibility Improvements

### Medium Priority (Do Next)
1. Task 1.4: Keyboard Shortcuts
2. Task 1.5: Ticket Count Badges
3. Task 2.2: Table View Toggle
4. Task 2.3: Rich Text Editor
5. Task 2.5: Activity Timeline
6. Task 2.6: Related/Linked Tickets
7. Task 3.1: Custom Fields
8. Task 3.3: Automation Rules
9. Task 3.4: Audit Trail
10. Task 4.5: Mobile Responsiveness

### Low Priority (Nice to Have)
1. Task 1.6: Copy Ticket Link
2. Task 1.7: Relative Timestamps
3. Task 4.2: Empty States
4. Task 4.3: Loading Skeletons
5. Task 4.4: Toast System

---

## Dependencies

```
Task 1.1 (Command Palette) → Can be done independently
Task 1.2 (Notifications) → Requires backend changes
Task 1.3 (Bulk Actions) → Requires Task 2.1 for better filtering
Task 2.1 (Filtering) → Foundation for Task 2.2 and Task 3.2
Task 2.3 (Rich Text) → Requires @mentions support
Task 3.1 (Custom Fields) → Foundation for Task 2.1 custom field filters
Task 3.2 (Reports) → Requires stable data model
Task 3.3 (Automation) → Can build on existing routing rules
```

---

*Document created: January 29, 2026*  
*Last updated: February 9, 2026 - status reconciled with implemented Phase 2/3 tasks.*
