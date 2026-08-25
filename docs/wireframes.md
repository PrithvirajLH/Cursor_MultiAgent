# Wireframes (Figma‑Style, Low‑Fidelity)

These are **low‑fidelity, Figma‑style wireframes** that capture layout and
information hierarchy (not visual design). They reflect the current product
structure and Sprint‑1 scope.

Legend:
- `[]` = container / card
- `| |` = sidebar / column
- `(...)` = button / CTA
- `----` = divider

---

## Frame 1 — Dashboard

```
┌────────────────────────────────────────────────────────────────────────────┐
│  SIDEBAR            │  TOP BAR                                             │
│  - Dashboard        │  Title: Dashboard                                    │
│  - My Tickets       │  Subtitle: Quick view of activity                    │
│  - Completed        │  Persona Switcher (dropdown)   (New Ticket)          │
│                     │                                                       │
├─────────────────────┴───────────────────────────────────────────────────────┤
│  [ KPI Cards ]                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                         │
│  │ Open         │ │ Resolved     │ │ Total        │                         │
│  └──────────────┘ └──────────────┘ └──────────────┘                         │
│                                                                             │
│  [ Recent Activity ]                                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ Ticket row (subject, team, status)                        date         │ │
│  │ Ticket row (subject, team, status)                        date         │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Frame 2 — Tickets List

```
┌────────────────────────────────────────────────────────────────────────────┐
│  SIDEBAR            │  TOP BAR                                             │
│  - Dashboard        │  Title: Tickets                                      │
│  - All Tickets      │  Filters: Search | Scope | Dept | Status | Sort       │
│  - Assigned to Me   │                                                       │
│  - Created by Me    │                                                       │
├─────────────────────┴───────────────────────────────────────────────────────┤
│  [ Tickets List ]                                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ Subject                                   Team • Status        Date   │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │ Subject                                   Team • Status        Date   │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │ Subject                                   Team • Status        Date   │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Frame 3 — Ticket Detail

```
┌────────────────────────────────────────────────────────────────────────────┐
│  SIDEBAR            │  TOP BAR                                             │
│  - Dashboard        │  Title: Ticket Detail                                 │
│  - Tickets          │  (New Ticket)                                        │
├─────────────────────┴───────────────────────────────────────────────────────┤
│  LEFT COLUMN                               │  RIGHT COLUMN                 │
│  [ Ticket Overview ]                       │  [ Requester / Details ]      │
│  - Ticket ID                               │  - Requester card             │
│  - Subject                                 │  - Department                 │
│  - Created date / by                        │  - Assignee                   │
│                                            │  - Channel / Category          │
│  [ Conversation ]                          │                               │
│  ┌───────────────────────────────────────┐ │  [ Status History ]           │
│  │ Message bubble (agent)                │ │  - Date • by who              │
│  │ Message bubble (requester)            │ │    Status: From → To          │
│  │ ...                                   │ │  - Date • by who              │
│  └───────────────────────────────────────┘ │                               │
│  [ Reply box + Send ]                      │                               │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Frame 4 — Create Ticket Modal

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [ Modal: Create Ticket ]                                                    │
│  - Department (dropdown)                                                    │
│  - Subject (text)                                                           │
│  - Description (textarea)                                                   │
│  - Priority (dropdown)       - Channel (dropdown)                           │
│  (Submit)                                                                   │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Frame 5 — Admin: Categories / Memberships / Routing Rules (M1 UI)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  SIDEBAR            │  TOP BAR                                             │
│  - Admin            │  Title: Admin                                        │
│                     │  Tabs: Categories | Team Members | Routing Rules     │
├─────────────────────┴───────────────────────────────────────────────────────┤
│  [ Table/List ]                                                             │
│  Row: Name • Status • Parent • Actions (Edit/Delete)                        │
│  Row: Name • Status • Parent • Actions (Edit/Delete)                        │
│                                                                             │
│  (Add New)                                                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Notes
- These wireframes are **structure only**; visual style is handled in UI.
- They match the current M1 flow and can be updated as features expand.

