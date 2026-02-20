## Codex Ticketing System – User Manual

### 1. Introduction

This manual explains how to use the Codex Ticketing System for each role:

- **User** (Employee / Requester)
- **Agent**
- **Lead**
- **Admin** (Team Admin)
- **Owner**

What you see in the app (navigation, pages, and actions) depends on your **role** and, for staff roles, your **team**.

### 2. Core Concepts

- **Ticket**: A request or issue raised by a User and worked on by support staff.
- **Status**: The current state of a ticket, for example `New`, `In Progress`, `Resolved`, `Closed`.
- **Team**: A group of Agents (and Leads/Admins) responsible for a shared ticket queue.
- **SLA (Service Level Agreement)**: Target response and resolution times, plus working hours.
- **Routing Rules**: Rules that automatically assign or change tickets based on conditions.
- **Automation Rules**: Rules that automatically perform actions (e.g. change priority, add notes) when conditions are met.
- **Custom Fields**: Extra fields on tickets (e.g. “Environment”, “Customer Tier”, “Department”).

The app layout is:

- **Sidebar (left)**: Navigation between pages.
- **Main content (center)**: Lists, dashboards, and details.
- **Filters/search (top of lists)**: Search and filter tickets, logs, or reports.
- **Ticket detail view**: Conversation, internal notes, assignee, status, fields, and actions.

---

### 3. Role Overview

#### 3.1 User (Employee / Requester)

**Purpose**: Raise and track your own tickets.

**What you typically see**

- `Dashboard`
- `Tickets` views such as:
  - `Created by Me`
  - `Completed`

You do **not** see Triage Board, Manager Views, Team, SLA Settings, or Admin features.

**What you can do**

- Create new tickets.
- View and search only your own tickets.
- Add **public replies** to tickets.
- Follow/unfollow your own tickets.

You **cannot**:

- Assign or transfer tickets.
- Change ticket status or SLA policy.
- Add internal notes (these are for staff only).

##### Step-by-step: Create a ticket

1. Open the web app and sign in.
2. From `Dashboard` or `Tickets → Created by Me`, click **New Ticket** / **Create Ticket**.
3. Fill out:
   - **Subject / Title** – short summary of the issue or request.
   - **Description** – detailed explanation, steps to reproduce, expected vs actual behavior.
   - **Category** – choose the closest matching category (if available).
   - **Custom fields** – fill any required extra fields (e.g. environment, urgency).
4. Attach any files (screenshots, logs, documents) if needed.
5. Click **Submit**. You are redirected to the ticket detail page or back to your list.

##### Step-by-step: Track and reply to a ticket

1. Go to `Tickets → Created by Me`.
2. Use search and filters (status, date, category) to locate your ticket.
3. Click on the ticket to open the **ticket detail** view.
4. In the conversation timeline:
   - Read updates from the support team.
   - Add **public replies** to provide more information or confirm resolution.
5. To follow or unfollow the ticket, use the **Follow / Unfollow** control on the ticket header.

---

#### 3.2 Agent

**Purpose**: Work tickets for your team and handle user requests.

**What you typically see**

- `Dashboard`
- `Tickets` with views such as:
  - `Assigned to Me`
  - `Unassigned`
  - `Created by Me`
  - `Completed`

You do **not** see Triage Board, Manager Views, Team, SLA Settings, or the Admin section.

**Ticket access**

- You see:
  - Tickets **assigned to you**.
  - **Unassigned** tickets belonging to your team.
- You do **not** see tickets for other teams (unless granted specially).

**What you can do**

- Take ownership of unassigned tickets.
- Reply publicly to users.
- Add internal notes visible only to staff.
- Change ticket status (for example, `New → In Progress → Resolved`).
- Assign tickets to yourself or other agents (depending on team policy).
- Adjust ticket fields such as priority, category, and custom fields.
- Use bulk actions on multiple tickets (if enabled).

##### Step-by-step: Work your queue

1. Go to `Tickets → Assigned to Me`.
2. Sort and filter by **priority**, **SLA**, **status**, or **due date**.
3. Open the top-priority or most urgent ticket.
4. In the ticket detail:
   - Review the request and history.
   - Add an **internal note** if you need to share context with colleagues.
   - Send a **public reply** to acknowledge and ask clarifying questions.
   - Update **status** to `In Progress` when you start working.

##### Step-by-step: Take a new ticket

1. Go to `Tickets → Unassigned`.
2. Filter by category or priority to find tickets you can handle.
3. Open a ticket and confirm you understand the issue.
4. Click **Assign to Me** (or similar) to take ownership.
5. Set the ticket **status** to `In Progress`.
6. Send a **public reply** to the requester with an acknowledgment and expected next steps.

##### Step-by-step: Transfer or escalate a ticket

1. Open the ticket detail.
2. Use the **Assignee** (and/or **Team**) field to:
   - Reassign to another agent on your team.
   - If team changes are allowed for your role, select the new team.
3. Add an **internal note** explaining why the ticket is being transferred.
4. Optionally send a **public reply** informing the requester of the escalation or handover.

##### Step-by-step: Use bulk actions (if available)

1. In `Tickets`, pick a view like `Unassigned` or `Assigned to Me`.
2. Check the boxes next to multiple tickets.
3. Use the bulk actions toolbar to:
   - Assign tickets to yourself or another agent.
   - Change status (e.g. close multiple resolved tickets).
   - Adjust priority.
4. Confirm the bulk action.

---

#### 3.3 Lead

**Purpose**: Supervise a team, manage its workload, and monitor performance.

**What you typically see**

- Everything an **Agent** sees, plus:
  - `Triage Board`
  - `Manager Views`
  - `Team`
  - `SLA Settings` (read-only)

Leads do **not** see the full Admin menu for routing rules, automation, custom fields, categories, or global reports.

**What you can do**

- All Agent actions on tickets for your team.
- View and manage your team’s overall queue.
- Use the **Triage Board** to assign and prioritize incoming work.
- Use **Manager Views** to monitor performance and workload.
- View team structure in the **Team** page.
- View SLA settings applicable to your team (but not edit them directly).

##### Step-by-step: Triage your team’s queue

1. Go to `Triage Board`.
2. Ensure your **team** is selected in the filter (if applicable).
3. Review how tickets are grouped (e.g. by status, priority, or queue).
4. For each new or unassigned ticket:
   - Assign it to an appropriate agent.
   - Adjust **priority** if needed.
   - Confirm that high-priority tickets have owners and clear next steps.
5. Revisit regularly to keep the queue under control.

##### Step-by-step: Use Manager Views

1. Go to `Manager Views`.
2. Choose a **time range** (for example, Today, Last 7 days, This month).
3. Check metrics such as:
   - Number of new tickets.
   - Backlog size.
   - Average and median resolution times.
   - SLA adherence rates.
   - Tickets handled per agent.
4. Use these insights to:
   - Balance workloads between agents.
   - Identify training needs.
   - Spot recurring issues that might need process or product changes.

##### Step-by-step: Review your Team

1. Go to `Team`.
2. Review:
   - Which members are on your team.
   - Their roles (Agent, Lead, Admin).
3. Use this for planning rotations, coverage, and escalation paths.

##### Step-by-step: Review SLA Settings (read-only)

1. Go to `SLA Settings`.
2. Review:
   - SLA policies assigned to your team.
   - Target response and resolution times by priority.
   - Business hours.
3. Use this information to:
   - Set expectations with your team.
   - Prioritize tickets approaching SLA breach.
   - Request changes from your Admin/Owner if policies are unrealistic.

---

#### 3.4 Admin (Team Admin)

**Purpose**: Administer configuration for your primary team (policies, rules, fields, and reporting). In the code this role is `TEAM_ADMIN`.

**What you typically see**

- Everything a **Lead** sees, plus an `Admin` menu that includes:
  - `SLA Policies` / `SLA Settings`
  - `Routing Rules`
  - `Automation Rules`
  - `Custom Fields`
  - `Audit Logs`
  - `Reports` (for your primary team)

You do **not** manage global categories or all teams; that is reserved for Owners.

**Scope**

- All admin actions are scoped to your **primary team**.
- You can view platform data as it relates to that team; you do not have platform-wide control.

**What you can do**

- Everything a **Lead** can do on tickets.
- Configure **SLA policies** and **business hours** for your primary team.
- Create and maintain **routing rules** for how tickets reach your team or agents.
- Define **automation rules** that run on your team’s tickets.
- Create and manage **custom fields** for your team’s tickets.
- View **audit logs** for your team’s activities.
- View **reports** scoped to your team.
- Manage your team members (add/remove members and adjust roles) for your primary team.

##### Step-by-step: Manage SLA Policies (primary team)

1. Go to `Admin → SLA Policies` or `SLA Settings`.
2. Ensure your **primary team** is selected in any team filter.
3. To create or edit a policy:
   - Provide a **name** and optional **description**.
   - Set **targets** such as:
     - First response time.
     - Resolution time.
   - Define **business hours** (work days and times).
   - Optionally adjust by **priority** (e.g. P1 vs P3).
4. Save the policy.
5. Verify that tickets for your team are picking up the correct SLA policy.

##### Step-by-step: Configure Routing Rules (primary team)

1. Go to `Admin → Routing Rules`.
2. Filter to your **primary team** if necessary.
3. For each rule:
   - Define **conditions** (e.g. category is “Billing”, subject contains “refund”, requester email domain).
   - Define **actions**:
     - Assign to a specific **team** (your team).
     - Assign to a specific **agent**.
     - Set **priority**, category, or custom field values.
4. Order rules logically if rule order matters (top-most first).
5. Save and test by creating tickets that should match the rules.

##### Step-by-step: Configure Automation Rules (primary team)

1. Go to `Admin → Automation Rules`.
2. Click **New Rule**.
3. Define:
   - **Trigger** (e.g. ticket created, updated, SLA near breach).
   - **Conditions** (e.g. ticket status is `New` and priority is `High`).
   - **Actions** such as:
     - Reassign ticket.
     - Change status or priority.
     - Add an internal note.
     - Notify a channel or user (if supported).
4. Save the rule.
5. Monitor behavior via **Audit Logs** to ensure it works as intended.

##### Step-by-step: Manage Custom Fields (primary team)

1. Go to `Admin → Custom Fields`.
2. To add a new field:
   - Choose a **field type** (text, number, dropdown, checkbox, etc.).
   - Set a **label** and optional **description**.
   - Decide if the field is **required** and on which forms (creation, update).
   - Scope it to **teams** or **categories** relevant to your primary team.
3. Save the field and confirm it appears on:
   - Ticket creation forms.
   - Ticket detail pages.

##### Step-by-step: Use Audit Logs (primary team)

1. Go to `Admin → Audit Logs`.
2. Filter by:
   - **Ticket ID**.
   - **User** (actor).
   - **Action type**.
   - **Date range**.
3. Use logs to:
   - Investigate changes (who changed what and when).
   - Validate routing and automation behavior.
   - Support incident or compliance reviews.

##### Step-by-step: Use Reports (primary team)

1. Go to `Admin → Reports`.
2. Select your **team** and **date range**.
3. Review:
   - Ticket volume.
   - SLA adherence.
   - Resolution times.
   - Agent-level performance metrics.
4. Export or share these insights with stakeholders.

##### Step-by-step: Manage Team Members (primary team)

1. Go to `Team`.
2. As an Admin for your primary team you can:
   - **Add** members (choose existing users, assign roles like Agent or Lead).
   - **Update** roles for current members.
   - **Remove** members who no longer belong on this team.
3. Always ensure at least one Lead or Admin remains on the team.

---

#### 3.5 Owner

**Purpose**: Own and administer the entire platform across all teams.

**What you typically see**

- All pages available to Admins, plus global administration features:
  - `Admin → Categories`
  - Full cross-team access for SLA Policies, Routing Rules, Automation Rules, Custom Fields, Audit Logs, and Reports.
- Ability to create and manage **teams** and set global defaults (e.g. default SLA policy).

**Scope**

- No team restriction: you can view and configure **all teams**.
- You can set **global defaults** and policies that affect the entire system.

**What you can do**

- Everything an **Admin** can do, but across all teams.
- Create and manage **teams**.
- Manage global **categories** used for ticket classification.
- Set and maintain the **default SLA policy**.
- Run **platform-wide reports**.
- Review **platform-wide audit logs**.

##### Step-by-step: Manage Categories (global)

1. Go to `Admin → Categories`.
2. To add a category:
   - Click **New Category**.
   - Provide a **name** and optional **description**.
   - Optionally define parent/child relationships or codes if supported.
3. To update or retire a category:
   - Edit its name or description.
   - Deactivate or archive it instead of deleting if it is referenced by existing tickets.
4. Ensure categories reflect how your organization wants to organize work (e.g. IT, HR, Finance).

##### Step-by-step: Manage Teams (global)

1. Go to the **Teams** management area (often under `Team` or `Admin`).
2. To create a team:
   - Click **New Team**.
   - Set a **name**, **description**, and optional metadata.
3. Add members to the team:
   - Select existing users and assign them roles (User/Agent/Lead/Admin for that team).
   - Designate a **primary team** for Team Admins.
4. Use teams to reflect your organizational structure and queues.

##### Step-by-step: Global SLAs and default policy

1. Go to `Admin → SLA Policies`.
2. Manage policies for any team:
   - Create or update policies used by multiple teams.
   - Assign policies to teams as needed.
3. Set the **default SLA policy**:
   - Choose which policy applies when no specific one is configured.
4. Coordinate with Team Admins and Leads to maintain consistent SLA standards.

##### Step-by-step: Cross-team Routing, Automation, and Custom Fields

1. Use `Admin → Routing Rules`, `Automation Rules`, and `Custom Fields` as described for Admins.
2. As Owner you can:
   - Target **multiple teams** or **all teams**.
   - Define mixed or cross-team routing behaviors.
   - Establish **global custom fields** shared across the platform.
3. Be cautious—changes here can affect every team. Validate with small pilots where possible.

##### Step-by-step: Platform-wide Audit Logs & Reports

1. Go to `Admin → Audit Logs`:
   - Remove any team filters to see activity across the whole platform.
   - Use filters by actor, action, ticket, or date for investigations.
2. Go to `Admin → Reports`:
   - Choose **All Teams** or specific teams.
   - Produce org-level performance and SLA reports.
3. Share insights with leadership and use them to guide resourcing and process decisions.

---

### 4. Authentication & Access Notes

- The system identifies you by your user account and associated **role** and **team membership**.
- Your role determines:
  - Which pages appear in the sidebar.
  - Which tickets you can see.
  - Which actions (assign, change status, configure rules, etc.) you can perform.
- Team Admins are scoped to their **primary team**; Owners have **no team restrictions**.

---

### 5. Tips for Effective Use

- **Users**: Provide clear, complete information when creating tickets; respond quickly to agent questions.
- **Agents**: Work from `Assigned to Me` and `Unassigned`, prioritize by SLA and impact, and document with internal notes.
- **Leads**: Use Triage Board and Manager Views regularly to balance workload and prevent SLA breaches.
- **Admins**: Introduce routing and automation rules gradually and validate them using Audit Logs and Reports.
- **Owners**: Standardize categories, SLAs, and key custom fields across teams; delegate day-to-day configuration to Team Admins where possible.

