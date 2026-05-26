# `/tickets` vs `/tickets-revamp` — Granular Feature Comparison

Updated 2026-05-04. Every feature, even tiny ones. ✅ = has it · ❌ = doesn't have it.

---

## 1 · Tickets list — display

| # | Feature | Legacy `/tickets` | Revamp `/tickets-revamp` |
|---:|---|:-:|:-:|
| 1.1 | Show ticket ID | ✅ | ✅ |
| 1.2 | Show subject | ✅ | ✅ |
| 1.3 | Show priority bar (3 vertical bars) | ✅ | ✅ |
| 1.4 | Show status as colored pill | ✅ | ✅ |
| 1.5 | Show assigned team | ✅ | ✅ |
| 1.6 | Show assignee avatar | ✅ | ✅ |
| 1.7 | Show assignee name (`@name`) | ✅ | ✅ |
| 1.8 | Show requester (customer name + email/ID) | ✅ | ✅ |
| 1.9 | Show SLA bar (color-coded) | ✅ | ✅ |
| 1.10 | Show SLA countdown text (`−14m`, `47m`, `3h 12m`) | ✅ | ✅ |
| 1.11 | Show updated relative time (`4m`, `2h`, `1d`) | ✅ | ✅ |
| 1.12 | Show tag chips on rows | ✅ | ❌ (schema gap) |
| 1.13 | Show row hover highlight | ✅ | ✅ |
| 1.14 | Show row selected highlight (indigo tint) | ✅ | ✅ |
| 1.15 | Show keyboard-focused row indicator (left border) | ✅ | ✅ |
| 1.16 | Sticky table header on scroll | ✅ | ✅ |
| 1.17 | Truncate long subjects with ellipsis | ✅ | ✅ |
| 1.18 | Skeleton placeholder rows on loading | ✅ | ✅ |
| 1.19 | Empty state ("no tickets match…") | ✅ | ✅ |
| 1.20 | Error state with retry button | ✅ | ✅ |

## 2 · Tickets list — filters & sort

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 2.1 | Filter by status (multi-select) | ✅ | ✅ |
| 2.2 | Filter by status group (Open / Resolved / All) | ✅ | ✅ |
| 2.3 | Filter by priority (multi-select P1-P4) | ✅ | ✅ |
| 2.4 | Filter by team (multi-select) | ✅ | ✅ |
| 2.5 | Filter by assignee (multi-select) | ✅ | ✅ |
| 2.6 | Filter by requester (multi-select) | ✅ | ❌ |
| 2.7 | Filter by SLA status (on track / at risk / breached) | ✅ | ✅ |
| 2.8 | Filter by created-from / created-to date | ✅ | ✅ |
| 2.9 | Filter by updated-from / updated-to date | ✅ | ✅ |
| 2.10 | Filter by due-from / due-to date | ✅ | ✅ |
| 2.11 | Free-text search (`q`) | ✅ | ✅ |
| 2.12 | Filter by scope (All / Assigned / Unassigned / Created) | ✅ | ✅ |
| 2.13 | Filter chips display (active filters as chips) | ✅ | ✅ |
| 2.14 | Remove single filter (X on chip) | ✅ | ✅ |
| 2.15 | Clear all filters button | ✅ | ✅ |
| 2.16 | Add-filter picker (full UI panel) | ✅ (slide-in) | ✅ (popover) |
| 2.17 | Sort by Updated | ✅ | ✅ |
| 2.18 | Sort by Created | ✅ | ✅ |
| 2.19 | Sort by Completed | ✅ | ✅ |
| 2.20 | Sort direction toggle (asc/desc) | ✅ | ✅ |
| 2.21 | Click column header to sort | ✅ | ✅ |
| 2.22 | Sort dropdown menu | ✅ | ✅ |
| 2.23 | URL state sync (filters/sort/page write to URL) | ✅ | ✅ |
| 2.24 | Back/forward browser buttons restore state | ✅ | ✅ |

## 3 · Tickets list — bulk actions

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 3.1 | Select via checkbox | ✅ | ✅ |
| 3.2 | Select with X keyboard | ✅ | ✅ |
| 3.3 | Range-select with Shift+X | ✅ | ✅ |
| 3.4 | Range-select with Shift+click | ✅ | ❌ |
| 3.5 | Select all on page (header checkbox) | ✅ | ✅ |
| 3.6 | Selection count display ("3 tickets selected") | ✅ | ✅ |
| 3.7 | Esc to clear selection | ✅ | ✅ |
| 3.8 | Bulk Assign-to-me | ✅ | ✅ |
| 3.9 | Bulk Unassign | ✅ | ✅ |
| 3.10 | Bulk Set status | ✅ | ✅ |
| 3.11 | Bulk Set priority | ✅ | ✅ |
| 3.12 | Bulk Transfer team | ✅ | ❌ |
| 3.13 | Bulk Add tag | ✅ (some) | ❌ |
| 3.14 | Bulk Merge | ✅ (some) | ❌ |
| 3.15 | Bulk Apply macro | ✅ (some) | ❌ |
| 3.16 | **Optimistic UI** (rows update instantly, rollback on error) | ❌ | ✅ |
| 3.17 | Toast notification on bulk success/error | ✅ | ❌ |
| 3.18 | Persona guard — EMPLOYEE doesn't see bulk UI | ✅ | ✅ |

## 4 · Tickets list — pagination & navigation

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 4.1 | Pagination footer (‹ ›) | ✅ | ✅ |
| 4.2 | Page X of Y display | ✅ | ✅ |
| 4.3 | Total result count | ✅ | ✅ |
| 4.4 | "Showing 1-N of M" footer | ✅ | ✅ |
| 4.5 | Page size selector | ✅ | ❌ (fixed at 50) |
| 4.6 | First/Last page buttons | ✅ | ❌ |
| 4.7 | J / K row navigation | ✅ | ✅ |
| 4.8 | Enter to open focused ticket | ✅ | ✅ |
| 4.9 | Click row to open detail | ✅ | ✅ |
| 4.10 | Cmd-click row to open in new tab | ✅ | ❌ |
| 4.11 | Realtime list updates on `ticket.changed` | ✅ | ✅ |

## 5 · Tickets list — saved views

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 5.1 | Save current filter as a named view | ✅ (Manager Views page) | ✅ (inline dialog) |
| 5.2 | List user's saved views in sidebar | ✅ | ✅ |
| 5.3 | Click to apply saved view | ✅ | ✅ |
| 5.4 | Delete saved view | ✅ | ✅ (hover X) |
| 5.5 | **Live count on each saved view** | ❌ | ✅ |
| 5.6 | **Saved-view PRESETS** (P1 today, Awaiting reply > 24h, etc.) | ❌ | ✅ |
| 5.7 | Default view (mark as default) | ✅ | ❌ |
| 5.8 | Edit saved view | ✅ | ❌ (delete + recreate) |

## 6 · Sidebar

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 6.1 | Workspace switcher (top) | ✅ | ✅ |
| 6.2 | Logo / mark | ✅ | ✅ |
| 6.3 | Dashboard link | ✅ | ✅ |
| 6.4 | Inbox link with live count | ✅ | ✅ |
| 6.5 | My tickets link with live count | ✅ | ✅ |
| 6.6 | Team queue link with live count | ✅ | ✅ |
| 6.7 | Created-by-me link with live count | ✅ | ✅ |
| 6.8 | Watching link | ✅ | ✅ (link only) |
| 6.9 | Watching live count | ✅ | ❌ |
| 6.10 | Mentions link | ✅ | ✅ |
| 6.11 | Mentions unread dot | ✅ | ✅ |
| 6.12 | Mentions live count | ✅ | ❌ |
| 6.13 | Active item indigo highlight | ✅ | ✅ |
| 6.14 | "Saved views" section header | ✅ | ✅ |
| 6.15 | "+ new saved view" affordance | ✅ | ✅ |
| 6.16 | Saved views list (presets) | ❌ | ✅ |
| 6.17 | Saved views list (user-created) | ✅ | ✅ |
| 6.18 | "Teams" section header | ✅ | ✅ |
| 6.19 | Teams listed with color dot | ✅ | ✅ |
| 6.20 | **Click team to filter list** | ❌ | ✅ |
| 6.21 | Team active highlight when filter applied | ❌ | ✅ |
| 6.22 | User card (bottom): avatar + name | ✅ | ✅ |
| 6.23 | User card: online green dot | ✅ | ✅ |
| 6.24 | User card: settings icon | ✅ | ✅ |
| 6.25 | Admin sidebar (extra menu for admins) | ✅ | ❌ |
| 6.26 | Sidebar collapse toggle | ✅ | ❌ |
| 6.27 | Mobile drawer | ✅ | ❌ |
| 6.28 | Dark mode toggle | ✅ | ❌ |

## 7 · Topbar

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 7.1 | Breadcrumb (Inbox › All open › …) | ✅ | ✅ |
| 7.2 | Breadcrumb chevron separator | ✅ | ✅ |
| 7.3 | Search input | ✅ | ✅ |
| 7.4 | Search placeholder | ✅ | ✅ |
| 7.5 | ⌘K to focus search | ✅ | ✅ |
| 7.6 | Live URL update on type (debounced) | ✅ | ✅ |
| 7.7 | New ticket button | ✅ | ✅ |
| 7.8 | New ticket button opens modal/page | ✅ | ❌ (placeholder) |
| 7.9 | Notifications bell | ✅ | ✅ (visual) |
| 7.10 | Bell unread badge with count | ✅ | ❌ |
| 7.11 | Bell click → notification center popover | ✅ | ❌ |
| 7.12 | Avatar | ✅ | ✅ |
| 7.13 | Avatar dropdown menu | ✅ | ❌ |
| 7.14 | Sign-out option in dropdown | ✅ | ❌ |
| 7.15 | **Multi-tab bar above content** (open tickets in tabs) | ✅ | ❌ |
| 7.16 | Tab close X button | ✅ | ❌ |
| 7.17 | Tab persistence across reloads | ✅ | ❌ |
| 7.18 | Right-click → "open in new tab" | ❌ | ❌ (planned) |

## 8 · Detail — layout

| # | Feature | Legacy `/tickets/:id` | Revamp `/tickets-revamp/:id` |
|---:|---|:-:|:-:|
| 8.1 | Single-column layout | ✅ | ❌ |
| 8.2 | 3-pane layout (sidebar / mid-list / center / properties) | ❌ | ✅ |
| 8.3 | Mid-list pane with compact ticket cards | ❌ | ✅ |
| 8.4 | Mid-list current-ticket highlight (3px indigo border) | ❌ | ✅ |
| 8.5 | Mid-list click swaps to that ticket | ❌ | ✅ |
| 8.6 | Mid-list preserves filters (URL ↔ state) | ❌ | ✅ |
| 8.7 | Properties side rail | ✅ (right rail) | ✅ (right pane) |

## 9 · Detail — header

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 9.1 | Subject as page title | ✅ | ✅ |
| 9.2 | Description preview below title | ✅ | ✅ |
| 9.3 | Status pill in header | ✅ | ✅ |
| 9.4 | Priority indicator in header | ✅ | ✅ |
| 9.5 | Ticket ID / display ID | ✅ | ✅ |
| 9.6 | Requester name in header meta | ✅ | ✅ |
| 9.7 | Created timestamp in header meta | ✅ | ✅ |
| 9.8 | Reply button | ✅ | ✅ |
| 9.9 | More-actions menu (…) | ✅ | ✅ |
| 9.10 | Copy ticket link button | ✅ | ❌ |

## 10 · Detail — conversation

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 10.1 | Tabs: Conversation / Attachments / Timeline | ✅ | ✅ |
| 10.2 | Tab counts | ✅ | ✅ |
| 10.3 | Chat-bubble messages | ✅ | ✅ |
| 10.4 | Own messages right-aligned, dark accent | ✅ | ✅ |
| 10.5 | Others' messages left-aligned, light bg | ✅ | ✅ |
| 10.6 | Avatar next to others' messages | ✅ | ✅ |
| 10.7 | Author name + timestamp above bubble | ✅ | ✅ |
| 10.8 | Date separators (Today / Yesterday / dates) | ✅ | ✅ |
| 10.9 | Internal note amber highlight | ✅ | ✅ |
| 10.10 | "Internal" badge on internal notes | ✅ | ✅ |
| 10.11 | HTML / rich-text rendering of message body | ✅ | ✅ |
| 10.12 | Load older messages (paginate up) | ✅ | ❌ (single page) |
| 10.13 | Jump-to-latest button | ✅ | ❌ |
| 10.14 | **Typing indicator** ("Alex is typing…") | ✅ | ❌ |
| 10.15 | Edit own message | ✅ | ❌ |
| 10.16 | Delete own message | ✅ | ❌ |
| 10.17 | Realtime new-message arrival | ✅ | ✅ |
| 10.18 | Animations on bubble appear | ✅ | ❌ |

## 11 · Detail — composer

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 11.1 | Public reply tab | ✅ | ✅ |
| 11.2 | Internal note tab | ✅ | ✅ |
| 11.3 | Forward tab | ✅ | ❌ (placeholder) |
| 11.4 | Bold | ✅ | ✅ |
| 11.5 | Italic | ✅ | ✅ |
| 11.6 | Bullet list | ✅ | ✅ |
| 11.7 | Numbered list | ✅ | ✅ |
| 11.8 | Inline code | ✅ | ✅ |
| 11.9 | Code block | ✅ | ✅ |
| 11.10 | Hyperlinks | ✅ | ✅ |
| 11.11 | View raw HTML | ✅ | ✅ |
| 11.12 | @mention autocomplete | ✅ | ✅ |
| 11.13 | Canned response insertion | ✅ | ✅ |
| 11.14 | Attach files (paperclip) | ✅ | ✅ |
| 11.15 | Drag-and-drop file attach | ✅ | ❌ |
| 11.16 | Multi-file upload | ✅ | ❌ (one at a time) |
| 11.17 | Upload progress indicator | ✅ | ✅ |
| 11.18 | Upload error display | ✅ | ✅ |
| 11.19 | Send button | ✅ | ✅ |
| 11.20 | Cmd+Enter to send | ✅ | ✅ |
| 11.21 | Empty-message disable send | ✅ | ✅ |

## 12 · Detail — properties / sidebar rail

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 12.1 | Status section | ✅ | ✅ |
| 12.2 | Status as dropdown (change inline) | ✅ | ✅ |
| 12.3 | Show only allowed status transitions | ✅ | ✅ |
| 12.4 | Priority section | ✅ | ✅ |
| 12.5 | Priority dropdown (change inline) | ✅ | ✅ |
| 12.6 | Assignee section | ✅ | ✅ |
| 12.7 | Assignee picker (search teammates) | ✅ | ✅ |
| 12.8 | "Assign to me" quick action | ✅ | ✅ |
| 12.9 | "Unassign" action | ✅ | ✅ |
| 12.10 | Department / Team display | ✅ | ✅ |
| 12.11 | **Transfer team** dropdown | ✅ | ❌ |
| 12.12 | Transfer also reassigns | ✅ | ❌ |
| 12.13 | Category display | ✅ | ✅ |
| 12.14 | Channel display | ✅ | ✅ |
| 12.15 | AI Classification panel (summary + confidence) | ✅ | ✅ |
| 12.16 | AI follow-up Q&A list | ✅ | ❌ |
| 12.17 | AI suggested next steps | ✅ | ❌ |
| 12.18 | **SLA Tracking — First Response** state row | ✅ | ✅ |
| 12.19 | **SLA Tracking — Resolution** state row | ✅ | ✅ |
| 12.20 | SLA states: Met / On track / At risk / Breached / Paused | ✅ | ✅ |
| 12.21 | Relative-time labels in SLA rows | ✅ | ✅ |
| 12.22 | **Watch / Unwatch button** | ✅ | ❌ |
| 12.23 | **Followers list** | ✅ | ❌ |
| 12.24 | Add a follower | ✅ | ❌ |
| 12.25 | Remove a follower | ✅ | ❌ |
| 12.26 | **Custom fields** (per category/team) | ✅ | ❌ |
| 12.27 | Edit custom field values | ✅ | ❌ |
| 12.28 | **Linked tickets** | ✅ | ❌ |
| 12.29 | Add linked ticket | ✅ | ❌ |
| 12.30 | Edit subject inline | ✅ | ❌ |
| 12.31 | Edit description inline | ✅ | ❌ |
| 12.32 | Information section (Email / Facility / Reference) | ✅ | ✅ |
| 12.33 | Created / Updated / Resolved timestamps | ✅ | ✅ |
| 12.34 | Activity log / event timeline | ✅ | ✅ |
| 12.35 | Activity event icons | ✅ | ✅ |
| 12.36 | **CSAT widget** (for resolved tickets) | ✅ | ❌ |

## 13 · Cross-cutting

| # | Feature | Legacy | Revamp |
|---:|---|:-:|:-:|
| 13.1 | Realtime ticket.changed (WebSocket) | ✅ | ✅ |
| 13.2 | Realtime invalidates list query | ✅ | ✅ |
| 13.3 | Realtime invalidates detail query | ✅ | ✅ |
| 13.4 | Realtime invalidates messages | ✅ | ✅ |
| 13.5 | Realtime invalidates events/timeline | ✅ | ✅ |
| 13.6 | Realtime typing indicator | ✅ | ❌ |
| 13.7 | Notification updates (in-app) | ✅ | ❌ |
| 13.8 | Page-level fade-in animation | ✅ | ❌ |
| 13.9 | Slide-in animations for panels | ✅ | ❌ |
| 13.10 | Smooth transitions between routes | ✅ | partial |
| 13.11 | Skeleton loading states | ✅ | ✅ |
| 13.12 | Error boundary fallback | ✅ | inherited |
| 13.13 | Toast notifications | ✅ | ❌ |
| 13.14 | Mobile responsive | ✅ | ❌ (desktop only) |
| 13.15 | Dark mode | ✅ | ❌ |

---

## Quick reference — only-revamp features

These rows above show **❌ in Legacy column / ✅ in Revamp column**:

| Row | Feature | Worth porting? |
|---|---|---|
| 3.16 | Optimistic UI on bulk actions | Probably yes — list feels snappier |
| 5.5 | Live count on every saved view | Probably yes — useful info |
| 5.6 | Saved-view presets (P1 today, Awaiting reply > 24h, etc.) | Probably yes — quick filter shortcuts |
| 6.20 / 6.21 | Click team in sidebar to filter | Probably yes — quick scope |
| 8.2 / 8.3 / 8.4 / 8.5 / 8.6 | 3-pane master-detail layout w/ mid-list | You said NO |

That's it — only ~5-6 importable features.

---

## Quick reference — only-legacy features (you'd lose if you scrap revamp)

If you abandon revamp without saving anything, you lose nothing because legacy already had everything else.

---

**Tell me which row numbers you want imported** (e.g. `3.16, 5.5, 5.6, 6.20`) and I'll port them into legacy `/tickets` without changing its design or animations.
