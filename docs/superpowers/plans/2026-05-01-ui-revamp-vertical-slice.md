# UI Revamp — Vertical Slice (Tokens + Atoms + Shell + Tickets List)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing Tickets List screen visual layer with the new design system from the helpdesk handoff (Inter typography + indigo/slate palette + dense Linear-style table), while keeping all existing data hooks and route wiring.

**Architecture:** Layered token replacement — port the design's CSS variables to the existing `apps/web/src/styles.css` so existing shadcn components inherit the new look automatically; build new design-specific atoms (`Pill`, `Prio`, `Avatar`, `SlaBar`, `Icn`, `AiChip`) under a new `components/atoms/` folder; rebuild Sidebar + Topbar as the new shell; replace TicketsPage's table with a new design implementation wired to existing tanstack-query data.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind 3.4, shadcn/ui, tanstack-query, react-router 6, lucide-react (existing) + new design's icon set.

**Spec / handoff:** `C:\Users\PHulgur\Downloads\Ticketing System\design_handoff_helpdesk\` (README.md, refs/styles.css, refs/refined-shared.jsx, refs/refined-list.jsx, refs/shared.jsx)

**Branch:** `feat/ui-revamp` (current). Light mode only for this slice; dark mode is a follow-up.

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `apps/web/src/styles.css` | Add `--c-*` design tokens; switch fonts to Inter + IBM Plex Mono; remap shadcn HSL vars to the indigo palette | Modify |
| `apps/web/tailwind.config.ts` | Update `fontFamily.sans` and `fontFamily.mono`; add design-specific color helpers | Modify |
| `apps/web/src/components/atoms/Pill.tsx` | Status / category badge | Create |
| `apps/web/src/components/atoms/Prio.tsx` | Priority indicator (3 vertical bars) | Create |
| `apps/web/src/components/atoms/Avatar.tsx` | Initials avatar with deterministic tone | Create |
| `apps/web/src/components/atoms/SlaBar.tsx` | Thin horizontal SLA progress bar | Create |
| `apps/web/src/components/atoms/AiChip.tsx` | AI confidence chip | Create |
| `apps/web/src/components/atoms/Icn.tsx` | Inline SVG icon system (paths in `I` object) | Create |
| `apps/web/src/components/atoms/index.ts` | Re-export all atoms | Create |
| `apps/web/src/components/atoms/atoms.test.tsx` | Smoke tests for each atom | Create |
| `apps/web/src/components/shell/AppSidebar.tsx` | New Sidebar (Workspace / nav / Saved views / Teams / User card) | Create |
| `apps/web/src/components/shell/AppTopbar.tsx` | New Topbar (breadcrumbs / search / + / bell / avatar) | Create |
| `apps/web/src/components/shell/AppShell.tsx` | Wraps sidebar + topbar + main slot | Create |
| `apps/web/src/pages/TicketsPage.tsx` | Replace with new design (header / filter chips / bulk bar / table / footer) | Replace |
| `apps/web/src/components/tickets/FilterChip.tsx` | Removable filter chip | Create |
| `apps/web/src/components/tickets/BulkActionBar.tsx` | Indigo-tinted bulk action bar (visible when selection > 0) | Create |
| `apps/web/src/components/tickets/TicketsTable.tsx` | Dense table — checkbox / Prio / ID / Subject / Customer / Status / Team / Assignee / SLA / Updated / overflow | Create |

Existing `apps/web/src/components/Sidebar.tsx` and `TicketTableView.tsx` will remain temporarily — `TicketsPage.tsx` swaps in the new components instead. (Other pages still consume the old Sidebar; they'll migrate in later tasks.)

---

## Task 1: Port design tokens + switch fonts

**Files:**
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/tailwind.config.ts`

**Goal:** When the dev server reloads, every shadcn surface picks up the new indigo accent and warm-neutral palette automatically, and Inter + IBM Plex Mono are loaded.

- [ ] **Step 1: Update the @import font URL in `styles.css`**

Open `apps/web/src/styles.css`. Find this line at the very top:

```css
@import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap");
```

Replace with:

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap");
```

- [ ] **Step 2: Replace the `:root` light-mode variables**

In `apps/web/src/styles.css`, find the `:root {` block (starts around line 12). Replace the entire `:root { ... }` block with:

```css
  :root {
    color-scheme: light;

    /* ─── New design tokens (--c-* names match handoff) ─── */
    --c-bg:           #f6f7f9;
    --c-surface:      #ffffff;
    --c-surface-2:    #fafbfc;
    --c-surface-3:    #f1f3f5;
    --c-border:       #e3e6ea;
    --c-border-strong:#ced2d8;
    --c-divider:      #eceff2;

    --c-fg:    #0f1419;
    --c-fg-2:  #2b3340;
    --c-fg-3:  #5c6573;
    --c-fg-4:  #8a92a0;
    --c-fg-5:  #b3b9c2;

    --c-accent:        #2d3da3;
    --c-accent-2:      #3b50c4;
    --c-accent-tint:   #eef0fb;
    --c-accent-tint-2: #dde1f5;

    --c-red:        #b42318;
    --c-red-tint:   #fdecec;
    --c-amber:      #b54708;
    --c-amber-tint: #fdf3e7;
    --c-green:      #1d7a4d;
    --c-green-tint: #e7f5ee;
    --c-blue:       #1454a8;
    --c-blue-tint:  #e6eef9;
    --c-purple:     #6b3aa3;
    --c-purple-tint:#f1ebf9;

    /* ─── shadcn HSL bridge (so existing components pick up the new look) ─── */
    --background: 220 14% 97%;          /* maps to --c-bg #f6f7f9 */
    --foreground: 215 26% 8%;           /* maps to --c-fg #0f1419 */

    --card: 0 0% 100%;                  /* --c-surface #ffffff */
    --card-foreground: 215 26% 8%;

    --popover: 0 0% 100%;
    --popover-foreground: 215 26% 8%;

    --primary: 232 57% 41%;             /* --c-accent #2d3da3 */
    --primary-foreground: 0 0% 100%;

    --secondary: 210 14% 95%;           /* --c-surface-3 */
    --secondary-foreground: 217 19% 21%;

    --muted: 210 14% 95%;
    --muted-foreground: 218 11% 41%;    /* --c-fg-3 */

    --accent: 232 67% 96%;              /* --c-accent-tint */
    --accent-foreground: 232 57% 41%;

    --destructive: 4 76% 40%;           /* --c-red */
    --destructive-foreground: 0 0% 100%;

    --border: 215 13% 90%;              /* --c-border */
    --input:  214 11% 82%;              /* --c-border-strong */
    --ring:   232 57% 41%;

    --chart-1: 232 57% 41%;
    --chart-2: 152 56% 30%;             /* --c-green */
    --chart-3: 25 87% 37%;              /* --c-amber */
    --chart-4: 4 76% 40%;               /* --c-red */
    --chart-5: 213 79% 37%;             /* --c-blue */

    --radius: 4px;
    --shadow-soft: 0 1px 2px rgba(15, 20, 25, 0.04), 0 2px 8px rgba(15, 20, 25, 0.04);
    --shadow-card: 0 1px 3px rgba(15, 20, 25, 0.06), 0 6px 24px rgba(15, 20, 25, 0.05);
    --shadow-elevated: 0 4px 16px rgba(15, 20, 25, 0.08), 0 20px 50px rgba(15, 20, 25, 0.08);
  }
```

Leave the `.dark { }` block below it untouched — dark mode is a follow-up; don't break it.

- [ ] **Step 3: Update `tailwind.config.ts` font families**

Open `apps/web/tailwind.config.ts`. Find:

```ts
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
```

Replace with:

```ts
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
```

- [ ] **Step 4: Verify the dev server picks it up**

```powershell
npm run dev -w apps/web
```

Open `http://localhost:5173`. Body text should render in **Inter**; numerals on the dashboard's KPI tiles should be in **IBM Plex Mono**. The page background should be the cool slate `#f6f7f9` (was warm ivory). The login button / primary CTAs should be deep indigo `#2d3da3` (was vibrant `#4f46e5`).

Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/styles.css apps/web/tailwind.config.ts
git commit -m "feat(ui): port design tokens + switch fonts to Inter + IBM Plex Mono"
```

---

## Task 2: Atoms — Pill, Prio, Avatar, SlaBar, AiChip, Icn

**Files:**
- Create: `apps/web/src/components/atoms/Pill.tsx`
- Create: `apps/web/src/components/atoms/Prio.tsx`
- Create: `apps/web/src/components/atoms/Avatar.tsx`
- Create: `apps/web/src/components/atoms/SlaBar.tsx`
- Create: `apps/web/src/components/atoms/AiChip.tsx`
- Create: `apps/web/src/components/atoms/Icn.tsx`
- Create: `apps/web/src/components/atoms/index.ts`
- Create: `apps/web/src/components/atoms/atoms.test.tsx`

**Goal:** Six atoms ported from the design's `shared.jsx`, rewritten as typed React components. Smoke tests verify they render without throwing and apply expected class names.

The design uses inline `style={{ ... }}` heavily, but since we already have Tailwind, prefer Tailwind classes that read the `--c-*` CSS vars. For things Tailwind can't express cleanly (the priority bar's three sub-bars), use `style={{ backgroundColor: 'var(--c-red)' }}` etc.

- [ ] **Step 1: Create `Pill.tsx`**

```tsx
import type { ReactNode } from 'react';

export type PillTone = 'gray' | 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'accent';

interface PillProps {
  tone?: PillTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

const TONE_STYLES: Record<PillTone, { bg: string; fg: string; border: string }> = {
  gray:   { bg: 'var(--c-surface-3)',     fg: 'var(--c-fg-3)',  border: 'var(--c-border)' },
  red:    { bg: 'var(--c-red-tint)',      fg: 'var(--c-red)',   border: '#f3c7c2' },
  amber:  { bg: 'var(--c-amber-tint)',    fg: 'var(--c-amber)', border: '#f4d8b6' },
  green:  { bg: 'var(--c-green-tint)',    fg: 'var(--c-green)', border: '#bfe2ce' },
  blue:   { bg: 'var(--c-blue-tint)',     fg: 'var(--c-blue)',  border: '#c0d4ee' },
  purple: { bg: 'var(--c-purple-tint)',   fg: 'var(--c-purple)',border: '#d8c5ec' },
  accent: { bg: 'var(--c-accent-tint)',   fg: 'var(--c-accent)',border: 'var(--c-accent-tint-2)' },
};

export function Pill({ tone = 'gray', dot = false, children, className = '' }: PillProps) {
  const t = TONE_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-px rounded-sm text-[11px] font-semibold uppercase tracking-[0.03em] leading-[1.5] border whitespace-nowrap ${className}`}
      style={{ backgroundColor: t.bg, color: t.fg, borderColor: t.border }}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'currentColor' }} />}
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Create `Prio.tsx`**

```tsx
export type PrioLevel = 'P1' | 'P2' | 'P3' | 'P4';

interface PrioProps {
  level: PrioLevel;
  className?: string;
}

const COLOR_MAP: Record<PrioLevel, [string, string, string]> = {
  // [bar1, bar2, bar3]; matches design CSS where lower-priority bars dim
  P1: ['var(--c-red)',   'var(--c-red)',   'var(--c-red)'],
  P2: ['var(--c-amber)', 'var(--c-amber)', 'var(--c-fg-5)'],
  P3: ['var(--c-fg-3)',  'var(--c-fg-5)',  'var(--c-fg-5)'],
  P4: ['var(--c-fg-5)',  'var(--c-fg-5)',  'var(--c-fg-5)'],
};

export function Prio({ level, className = '' }: PrioProps) {
  const [c1, c2, c3] = COLOR_MAP[level];
  return (
    <span className={`inline-flex gap-px items-end h-3 ${className}`} title={level}>
      <i className="block w-[3px] h-1"   style={{ backgroundColor: c1 }} />
      <i className="block w-[3px] h-2"   style={{ backgroundColor: c2 }} />
      <i className="block w-[3px] h-3"   style={{ backgroundColor: c3 }} />
    </span>
  );
}
```

- [ ] **Step 3: Create `Avatar.tsx`**

```tsx
export type AvatarTone = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  name: string;          // 1-3 char initials, e.g. "EM", "JD"
  size?: AvatarSize;
  tone?: AvatarTone;
  className?: string;
}

const TONE: Record<AvatarTone, { bg: string; fg: string }> = {
  a: { bg: '#e6eef9', fg: '#1454a8' },
  b: { bg: '#fdf3e7', fg: '#b54708' },
  c: { bg: '#e7f5ee', fg: '#1d7a4d' },
  d: { bg: '#f1ebf9', fg: '#6b3aa3' },
  e: { bg: '#fdecec', fg: '#b42318' },
  f: { bg: '#eef0fb', fg: '#2d3da3' },
  g: { bg: '#f1f3f5', fg: '#5c6573' },
};

const SIZE: Record<AvatarSize, { box: string; font: string }> = {
  sm: { box: 'w-[18px] h-[18px]', font: 'text-[9px]'  },
  md: { box: 'w-[22px] h-[22px]', font: 'text-[10px]' },
  lg: { box: 'w-[32px] h-[32px]', font: 'text-[12px]' },
  xl: { box: 'w-[40px] h-[40px]', font: 'text-[14px]' },
};

/** Deterministic tone from a name. Use when caller doesn't specify a tone. */
export function toneFromName(name: string): AvatarTone {
  const tones: AvatarTone[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const sum = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return tones[sum % tones.length];
}

export function Avatar({ name, size = 'md', tone, className = '' }: AvatarProps) {
  const t = TONE[tone ?? toneFromName(name)];
  const s = SIZE[size];
  return (
    <span
      className={`${s.box} ${s.font} rounded-full inline-flex items-center justify-center font-semibold flex-none ${className}`}
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {name}
    </span>
  );
}
```

- [ ] **Step 4: Create `SlaBar.tsx`**

```tsx
export type SlaState = 'ok' | 'warn' | 'breach';

interface SlaBarProps {
  pct: number;          // 0-100
  state?: SlaState;
  className?: string;
}

const COLOR: Record<SlaState, string> = {
  ok:     'var(--c-green)',
  warn:   'var(--c-amber)',
  breach: 'var(--c-red)',
};

export function SlaBar({ pct, state = 'ok', className = '' }: SlaBarProps) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div
      className={`h-1 rounded-sm overflow-hidden relative ${className}`}
      style={{ backgroundColor: 'var(--c-surface-3)' }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="block h-full" style={{ width: `${clamped}%`, backgroundColor: COLOR[state] }} />
    </div>
  );
}
```

- [ ] **Step 5: Create `Icn.tsx`** (icon set + SVG component)

```tsx
import type { ReactNode, SVGProps } from 'react';

interface IcnProps extends Omit<SVGProps<SVGSVGElement>, 'd'> {
  d: ReactNode;          // single <path /> or fragment of multiple paths
  s?: number;            // size in px
  sw?: number;           // stroke width
}

export function Icn({ d, s = 14, sw = 1.5, ...rest }: IcnProps) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none' }}
      aria-hidden="true"
      {...rest}
    >
      {d}
    </svg>
  );
}

// Path set — copied verbatim from design's `I` object
export const I = {
  search:    <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.3-4.3" />,
  bell:      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9Zm4 13a2 2 0 0 0 4 0" />,
  filter:    <path d="M3 5h18M6 12h12M10 19h4" />,
  plus:      <path d="M12 5v14M5 12h14" />,
  more:      <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  inbox:     <path d="M3 13h4l2 3h6l2-3h4M3 13l3-8h12l3 8M3 13v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" />,
  ticket:    <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6Z M9 5v14" />,
  chart:     <path d="M3 21h18M7 17V11M12 17V7M17 17v-9" />,
  users:     <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7.87a4 4 0 0 1 0 7.75" />,
  settings:  <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7-3a7 7 0 0 0-.1-1.2l2-1.6-2-3.5-2.5.8a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.3a7 7 0 0 0-2 1.2l-2.5-.8-2 3.5 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.5 2.5-.8a7 7 0 0 0 2 1.2L10 21h4l.4-2.3a7 7 0 0 0 2-1.2l2.5.8 2-3.5-2-1.6c.07-.4.1-.8.1-1.2Z" />,
  arrowUp:   <path d="M12 19V5M5 12l7-7 7 7" />,
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" />,
  clock:     <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert:     <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  check:     <path d="M20 6 9 17l-5-5" />,
  paperclip: <path d="m21 12.5-9 9a6 6 0 1 1-8.5-8.5l9-9a4 4 0 1 1 5.7 5.7l-9 9a2 2 0 1 1-2.8-2.8l8.3-8.3" />,
  send:      <path d="m22 2-7 20-4-9-9-4 20-7Z" />,
  x:         <path d="M18 6 6 18M6 6l12 12" />,
  chevR:     <path d="m9 6 6 6-6 6" />,
  chevD:     <path d="m6 9 6 6 6-6" />,
  link:      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />,
  tag:       <><path d="M20 12 12 20 3 11V3h8l9 9Z" /><circle cx="7.5" cy="7.5" r="1" /></>,
  shield:    <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3Z" />,
  flag:      <path d="M4 21V4M4 4h12l-2 4 2 4H4" />,
  eye:       <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  pin:       <path d="M12 17v5M9 11V4h6v7l3 3v2H6v-2l3-3Z" />,
  reply:     <path d="M9 17 4 12l5-5M4 12h11a5 5 0 0 1 5 5v3" />,
  note:      <path d="M11 4H4v16h16v-7M19 3l-9 9v3h3l9-9-3-3Z" />,
  bolt:      <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
  msg:       <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" />,
  history:   <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  sparkle:   <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />,
} as const;
```

- [ ] **Step 6: Create `AiChip.tsx`**

```tsx
import { Icn, I } from './Icn';

interface AiChipProps {
  conf: number;          // 0-100
  className?: string;
}

export function AiChip({ conf, className = '' }: AiChipProps) {
  const low = conf < 70;
  const color = low ? 'var(--c-amber)' : 'var(--c-accent)';
  const bg    = low ? 'var(--c-amber-tint)' : 'var(--c-accent-tint)';
  const border= low ? '#f4d8b6' : 'var(--c-accent-tint-2)';
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-px rounded-sm text-[11px] font-semibold border ${className}`}
      style={{ backgroundColor: bg, color, borderColor: border }}
    >
      <Icn d={I.sparkle} s={11} />
      <span className="tabular-nums">{conf}%</span>
    </span>
  );
}
```

- [ ] **Step 7: Create `index.ts`**

```ts
export { Pill } from './Pill';
export type { PillTone } from './Pill';
export { Prio } from './Prio';
export type { PrioLevel } from './Prio';
export { Avatar, toneFromName } from './Avatar';
export type { AvatarTone, AvatarSize } from './Avatar';
export { SlaBar } from './SlaBar';
export type { SlaState } from './SlaBar';
export { AiChip } from './AiChip';
export { Icn, I } from './Icn';
```

- [ ] **Step 8: Create smoke tests `atoms.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Pill, Prio, Avatar, SlaBar, AiChip, Icn, I, toneFromName } from './index';

describe('atoms', () => {
  it('Pill renders children with tone class', () => {
    render(<Pill tone="red">P1</Pill>);
    expect(screen.getByText('P1')).toBeInTheDocument();
  });

  it('Pill with dot renders 2 children (dot + text)', () => {
    const { container } = render(<Pill tone="green" dot>open</Pill>);
    expect(container.querySelector('span > span')).not.toBeNull();
  });

  it('Prio renders 3 sub-bars', () => {
    const { container } = render(<Prio level="P1" />);
    expect(container.querySelectorAll('i').length).toBe(3);
  });

  it('Avatar shows initials and uses deterministic tone when not specified', () => {
    render(<Avatar name="EM" />);
    expect(screen.getByText('EM')).toBeInTheDocument();
  });

  it('toneFromName is deterministic', () => {
    expect(toneFromName('EM')).toBe(toneFromName('EM'));
  });

  it('SlaBar clamps pct to 0-100 and exposes ARIA value', () => {
    const { container } = render(<SlaBar pct={150} state="warn" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('AiChip renders confidence and amber tone when below 70', () => {
    render(<AiChip conf={42} />);
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('Icn renders an svg with given path', () => {
    const { container } = render(<Icn d={I.check} />);
    expect(container.querySelector('svg path')).not.toBeNull();
  });
});
```

- [ ] **Step 9: Run tests**

```powershell
npm run test -w apps/web -- atoms
```

Expected: 8 passing tests.

If the test runner can't find `@testing-library/react`, install it:

```powershell
npm install -D -w apps/web @testing-library/react @testing-library/jest-dom jsdom
```

And ensure `apps/web/vite.config.ts` has `test.environment = 'jsdom'`. Inspect existing test files (e.g. `apps/web/src/components/notification-center.test.tsx`) — if other tests already use these, no install is needed.

- [ ] **Step 10: Commit**

```powershell
git add apps/web/src/components/atoms/
git commit -m "feat(ui): add design-system atoms (Pill, Prio, Avatar, SlaBar, AiChip, Icn)"
```

---

## Task 3: Shell — Sidebar + Topbar + AppShell

**Files:**
- Create: `apps/web/src/components/shell/AppSidebar.tsx`
- Create: `apps/web/src/components/shell/AppTopbar.tsx`
- Create: `apps/web/src/components/shell/AppShell.tsx`

**Goal:** A 224px sidebar + 40px topbar that match the design's `RefinedSidebar` and `RefinedTopbar`. The shell wraps a children slot for the page.

The existing app's `Sidebar.tsx` keeps working for non-revamped pages; this new shell is opt-in.

- [ ] **Step 1: Create `AppSidebar.tsx`**

```tsx
import { Link, useLocation } from 'react-router-dom';
import { Icn, I, Avatar } from '../atoms';

interface NavItem {
  to: string;
  icon: typeof I.inbox;
  label: string;
  count?: string;
  hasDot?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/dashboard',   icon: I.chart,  label: 'Dashboard' },
  { to: '/tickets',     icon: I.inbox,  label: 'Inbox',       count: '142' },
  { to: '/my-tickets',  icon: I.ticket, label: 'My tickets',  count: '14'  },
  { to: '/team',        icon: I.users,  label: 'Team queue',  count: '38'  },
  { to: '/watching',    icon: I.eye,    label: 'Watching',    count: '7'   },
  { to: '/mentions',    icon: I.bell,   label: 'Mentions',    count: '3', hasDot: true },
];

const SAVED_VIEWS = [
  { label: 'P1 today',                count: '4',  tone: 'red'   as const },
  { label: 'Awaiting reply > 24h',    count: '11', tone: 'amber' as const },
  { label: 'Breach risk · 1h',        count: '8',  tone: 'amber' as const },
  { label: 'Unassigned',              count: '17', tone: 'gray'  as const },
  { label: 'Enterprise tier',         count: '52', tone: 'gray'  as const },
  { label: 'API errors',              count: '9',  tone: 'gray'  as const },
];

const TEAMS = [
  { label: 'Platform',   color: 'var(--c-accent)', count: '38' },
  { label: 'Identity',   color: 'var(--c-amber)',  count: '24' },
  { label: 'Data',       color: 'var(--c-green)',  count: '19' },
  { label: 'Mobile',     color: 'var(--c-purple)', count: '14' },
  { label: 'Compliance', color: 'var(--c-fg-3)',   count: '6'  },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  const isActive = (to: string) => pathname.startsWith(to);

  return (
    <aside
      className="w-[224px] flex flex-col flex-none border-r"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      {/* Workspace switcher */}
      <div
        className="px-3.5 py-3 flex items-center gap-2 border-b"
        style={{ borderColor: 'var(--c-border)' }}
      >
        <div
          className="w-6 h-6 rounded grid place-items-center text-[11px] font-bold tracking-tighter"
          style={{ backgroundColor: 'var(--c-fg)', color: 'white' }}
        >HD</div>
        <div className="flex flex-col min-w-0 flex-1">
          <div className="text-[12px] font-semibold leading-tight">Helpdesk</div>
          <div className="text-[10px]" style={{ color: 'var(--c-fg-4)' }}>CSH · Production</div>
        </div>
        <Icn d={I.chevD} s={11} />
      </div>

      {/* Scrollable nav */}
      <div className="p-2 text-[12px] flex-1 overflow-auto">
        {PRIMARY_NAV.map(r => {
          const active = isActive(r.to);
          return (
            <Link
              key={r.to}
              to={r.to}
              className="flex items-center gap-2 px-2 py-1 rounded-[3px] mb-px"
              style={{
                backgroundColor: active ? 'var(--c-accent-tint)' : 'transparent',
                color: active ? 'var(--c-accent)' : 'var(--c-fg-2)',
                fontWeight: active ? 600 : 500,
              }}
            >
              <Icn d={r.icon} s={14} />
              <span className="flex-1">{r.label}</span>
              {r.hasDot && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--c-red)' }} />}
              {r.count && (
                <span className="font-mono text-[10px]" style={{ color: active ? 'var(--c-accent)' : 'var(--c-fg-4)' }}>
                  {r.count}
                </span>
              )}
            </Link>
          );
        })}

        {/* Saved views */}
        <div className="px-2 pt-3.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] flex justify-between" style={{ color: 'var(--c-fg-4)' }}>
          <span>Saved views</span><Icn d={I.plus} s={11} />
        </div>
        {SAVED_VIEWS.map(v => (
          <div key={v.label} className="flex items-center gap-2 px-2 py-1 text-[12px]">
            <span
              className="w-1.5 h-1.5 rounded-full flex-none"
              style={{
                backgroundColor:
                  v.tone === 'red' ? 'var(--c-red)' : v.tone === 'amber' ? 'var(--c-amber)' : 'var(--c-fg-5)',
              }}
            />
            <span className="flex-1 min-w-0 truncate">{v.label}</span>
            <span className="font-mono text-[10px]" style={{ color: 'var(--c-fg-4)' }}>{v.count}</span>
          </div>
        ))}

        {/* Teams */}
        <div className="px-2 pt-3.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--c-fg-4)' }}>Teams</div>
        {TEAMS.map(t => (
          <div key={t.label} className="flex items-center gap-2 px-2 py-1 text-[12px]">
            <span className="w-2 h-2 rounded-sm flex-none" style={{ backgroundColor: t.color }} />
            <span className="flex-1">{t.label}</span>
            <span className="font-mono text-[10px]" style={{ color: 'var(--c-fg-4)' }}>{t.count}</span>
          </div>
        ))}
      </div>

      {/* User card (bottom) */}
      <div
        className="p-2.5 border-t flex items-center gap-2"
        style={{ borderColor: 'var(--c-border)' }}
      >
        <Avatar name="EM" tone="f" />
        <div className="text-[12px] flex-1 min-w-0">
          <div className="truncate font-medium">Elena Marquez</div>
          <div className="text-[10px] flex items-center gap-1" style={{ color: 'var(--c-fg-4)' }}>
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: 'var(--c-green)' }} />
            Online
          </div>
        </div>
        <Icn d={I.settings} s={14} />
      </div>
    </aside>
  );
}
```

(Notes for the implementer: Sidebar populates with hard-coded labels/counts for now. Real counts come later; that's a separate task.)

- [ ] **Step 2: Create `AppTopbar.tsx`**

```tsx
import { Icn, I, Avatar } from '../atoms';

interface AppTopbarProps {
  crumbs: string[];
}

export function AppTopbar({ crumbs }: AppTopbarProps) {
  return (
    <header
      className="flex items-center h-10 px-3.5 gap-3.5 flex-none border-b"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <nav className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--c-fg-4)' }} aria-label="Breadcrumb">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <Icn d={I.chevR} s={11} />}
              <span style={{ color: last ? 'var(--c-fg)' : 'var(--c-fg-4)', fontWeight: last ? 600 : 400 }}>{c}</span>
            </span>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div
        className="flex items-center rounded gap-1.5 text-[12px] w-80 px-2 py-[3px] border"
        style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-fg-4)' }}
      >
        <Icn d={I.search} s={13} />
        <span>Search tickets, customers, KB…</span>
        <span className="flex-1" />
        <span
          className="font-mono text-[10px] px-1 py-px rounded-sm border"
          style={{
            backgroundColor: 'var(--c-surface-3)',
            borderColor: 'var(--c-border)',
            borderBottomWidth: 2,
            color: 'var(--c-fg-3)',
          }}
        >⌘K</span>
      </div>

      <button
        className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded text-[12px] font-medium border"
        style={{
          backgroundColor: 'var(--c-surface)',
          color: 'var(--c-fg-2)',
          borderColor: 'var(--c-border-strong)',
        }}
      >
        <Icn d={I.plus} s={11} /> New ticket
      </button>

      <div className="relative">
        <Icn d={I.bell} s={15} />
        <span
          className="absolute -top-0.5 -right-0.5 w-[7px] h-[7px] rounded-full border-[1.5px]"
          style={{ backgroundColor: 'var(--c-red)', borderColor: 'white' }}
        />
      </div>

      <Avatar name="EM" tone="f" />
    </header>
  );
}
```

- [ ] **Step 3: Create `AppShell.tsx`**

```tsx
import type { ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { AppTopbar } from './AppTopbar';

interface AppShellProps {
  crumbs: string[];
  children: ReactNode;
}

export function AppShell({ crumbs, children }: AppShellProps) {
  return (
    <div
      className="w-full h-screen flex"
      style={{ backgroundColor: 'var(--c-bg)', color: 'var(--c-fg)', fontFamily: 'var(--f-sans, Inter, sans-serif)' }}
    >
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AppTopbar crumbs={crumbs} />
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Visual check**

Open the dev server (`npm run dev -w apps/web`). The new shell is created but not yet wired into any route — visual check happens in Task 4.

Run the existing tests to confirm we didn't break anything:

```powershell
npm run test -w apps/web -- --run
```

Expected: existing tests still pass; the new atom tests pass. No regressions.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/components/shell/
git commit -m "feat(ui): add AppShell (sidebar + topbar) per design handoff"
```

---

## Task 4: Tickets List page — visual layer with mock data

**Files:**
- Create: `apps/web/src/components/tickets/FilterChip.tsx`
- Create: `apps/web/src/components/tickets/BulkActionBar.tsx`
- Create: `apps/web/src/components/tickets/TicketsTable.tsx`
- Create: `apps/web/src/components/tickets/mock-tickets.ts`
- Create: `apps/web/src/pages/TicketsPageRevamp.tsx` *(new file; doesn't replace TicketsPage yet)*
- Modify: `apps/web/src/App.tsx` (add a sibling route `/tickets-revamp` for visual review only — you'll remove it after wiring)

**Goal:** Build the visual layer of the tickets list using mock data first. Real-data wiring comes in Task 5. Until then, you can compare against the design's reference at full fidelity without async/loading concerns.

- [ ] **Step 1: Create `mock-tickets.ts`** — copy the design's TICKETS array, typed.

```ts
import type { PrioLevel } from '../atoms';

export interface MockTicket {
  id: string;
  subject: string;
  customer: string;
  customerId: string;
  priority: PrioLevel;
  status: string;
  statusTone: 'red' | 'amber' | 'green' | 'blue' | 'gray' | 'purple';
  team: string;
  assigneeInitials: string;
  assigneeTone: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
  sla: { pct: number; state: 'ok' | 'warn' | 'breach'; text: string };
  age: string;
  updated: string;
  tags: string[];
  channel: string;
}

export const MOCK_TICKETS: MockTicket[] = [
  { id: 'TCK-48201', subject: 'Production API returning 503 on /v2/orders endpoint', customer: 'Northwind Logistics', customerId: 'ENT-0021', priority: 'P1', status: 'open',        statusTone: 'red',   team: 'Platform',    assigneeInitials: 'AK', assigneeTone: 'e', sla: { pct: 92, state: 'breach', text: '−14m'  }, age: '2h 14m', updated: '4m',  tags: ['outage', 'tier-1'],  channel: 'email'  },
  { id: 'TCK-48199', subject: 'SSO login failing for new Azure AD tenant migration', customer: 'Globex Industries',  customerId: 'ENT-0044', priority: 'P1', status: 'in progress', statusTone: 'amber', team: 'Identity',    assigneeInitials: 'MR', assigneeTone: 'b', sla: { pct: 76, state: 'warn',   text: '47m'   }, age: '5h 02m', updated: '11m', tags: ['sso', 'auth'],       channel: 'portal' },
  { id: 'TCK-48197', subject: 'Bulk export job stuck at 84% for 6+ hours',           customer: 'Initech Corp',       customerId: 'ENT-0102', priority: 'P2', status: 'in progress', statusTone: 'amber', team: 'Data',        assigneeInitials: 'JC', assigneeTone: 'c', sla: { pct: 58, state: 'ok',     text: '3h 12m'}, age: '8h 41m', updated: '32m', tags: ['exports', 'jobs'],   channel: 'email'  },
  { id: 'TCK-48195', subject: 'Webhook signature verification fails after key rotation', customer: 'Stark Industries', customerId: 'ENT-0007', priority: 'P2', status: 'pending',     statusTone: 'blue',  team: 'Platform',    assigneeInitials: 'AK', assigneeTone: 'e', sla: { pct: 42, state: 'ok',     text: '6h 50m'}, age: '12h 18m',updated: '1h',  tags: ['webhooks'],          channel: 'api'    },
  { id: 'TCK-48192', subject: 'Permission inheritance not propagating to nested folders', customer: 'Wayne Enterprises',customerId: 'ENT-0019', priority: 'P3', status: 'open',        statusTone: 'red',   team: 'Permissions', assigneeInitials: 'SP', assigneeTone: 'd', sla: { pct: 28, state: 'ok',     text: '1d 2h' }, age: '1d 4h',  updated: '2h',  tags: ['permissions','rbac'],channel: 'portal' },
  { id: 'TCK-48190', subject: 'Reporting dashboard shows incorrect MRR for January', customer: 'Acme Co.',           customerId: 'ENT-0033', priority: 'P3', status: 'in progress', statusTone: 'amber', team: 'Analytics',   assigneeInitials: 'TL', assigneeTone: 'a', sla: { pct: 35, state: 'ok',     text: '18h'   }, age: '1d 1h',  updated: '3h',  tags: ['reporting'],         channel: 'email'  },
  { id: 'TCK-48188', subject: 'CSV import truncates rows over 50k entries',          customer: 'Umbrella LLC',       customerId: 'ENT-0091', priority: 'P3', status: 'pending',     statusTone: 'blue',  team: 'Data',        assigneeInitials: 'JC', assigneeTone: 'c', sla: { pct: 22, state: 'ok',     text: '1d 8h' }, age: '1d 8h',  updated: '5h',  tags: ['imports'],           channel: 'portal' },
  { id: 'TCK-48184', subject: 'Mobile app crashes on contacts screen — iOS 17.3',    customer: 'Cyberdyne Systems',  customerId: 'ENT-0058', priority: 'P2', status: 'open',        statusTone: 'red',   team: 'Mobile',      assigneeInitials: 'RG', assigneeTone: 'b', sla: { pct: 88, state: 'warn',   text: '12m'   }, age: '4h 30m', updated: '8m',  tags: ['ios', 'crash'],      channel: 'app'    },
  { id: 'TCK-48180', subject: 'Two-factor recovery codes not delivering via SMS',    customer: 'Tyrell Corp',        customerId: 'ENT-0066', priority: 'P2', status: 'in progress', statusTone: 'amber', team: 'Identity',    assigneeInitials: 'MR', assigneeTone: 'b', sla: { pct: 64, state: 'ok',     text: '2h 40m'}, age: '6h 12m', updated: '22m', tags: ['2fa', 'sms'],        channel: 'email'  },
  { id: 'TCK-48177', subject: 'Custom field "Account Tier" not appearing in API response', customer: 'Soylent Corp', customerId: 'ENT-0118', priority: 'P3', status: 'open',        statusTone: 'red',   team: 'Platform',    assigneeInitials: 'AK', assigneeTone: 'e', sla: { pct: 18, state: 'ok',     text: '2d 1h' }, age: '2d 3h',  updated: '6h',  tags: ['api', 'fields'],     channel: 'api'    },
  { id: 'TCK-48171', subject: 'Slack integration disconnected after workspace rename', customer: 'Pied Piper',       customerId: 'ENT-0077', priority: 'P3', status: 'pending',     statusTone: 'blue',  team: 'Integrations',assigneeInitials: 'NB', assigneeTone: 'a', sla: { pct: 14, state: 'ok',     text: '2d 8h' }, age: '2d 11h', updated: '14h', tags: ['slack'],             channel: 'portal' },
  { id: 'TCK-48168', subject: 'Audit log retention policy not honoring 7-year setting', customer: 'Massive Dynamic',  customerId: 'ENT-0009', priority: 'P2', status: 'in progress', statusTone: 'amber', team: 'Compliance',  assigneeInitials: 'EH', assigneeTone: 'd', sla: { pct: 71, state: 'warn',   text: '1h 45m'}, age: '7h',     updated: '30m', tags: ['audit','compliance'],channel: 'email'  },
];
```

- [ ] **Step 2: Create `FilterChip.tsx`**

```tsx
import { Icn, I } from '../atoms';

interface FilterChipProps {
  label: string;          // "status"
  value: string;          // "open, in_progress"
  active?: boolean;
  removable?: boolean;
  onRemove?: () => void;
}

export function FilterChip({ label, value, active = false, removable = true, onRemove }: FilterChipProps) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-[3px] border"
      style={{
        backgroundColor: active ? 'var(--c-accent-tint)' : 'var(--c-surface)',
        borderColor:     active ? 'var(--c-accent-tint-2)' : 'var(--c-border)',
        color:           active ? 'var(--c-accent)' : 'var(--c-fg-2)',
      }}
    >
      <span style={{ color: active ? 'var(--c-accent)' : 'var(--c-fg-4)' }}>{label}:</span>
      <span className="font-medium">{value}</span>
      {removable && (
        <button onClick={onRemove} className="hover:opacity-70" aria-label={`Remove ${label} filter`}>
          <Icn d={I.x} s={10} />
        </button>
      )}
    </span>
  );
}
```

- [ ] **Step 3: Create `BulkActionBar.tsx`**

```tsx
interface BulkActionBarProps {
  count: number;
  onClear?: () => void;
}

export function BulkActionBar({ count, onClear }: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div
      className="px-4.5 py-1.5 flex items-center gap-2.5 text-[12px] border-b"
      style={{ backgroundColor: 'var(--c-accent-tint)', borderColor: 'var(--c-accent-tint-2)', padding: '6px 18px' }}
    >
      <span className="font-semibold" style={{ color: 'var(--c-accent)' }}>
        {count} ticket{count === 1 ? '' : 's'} selected
      </span>
      <span className="w-px h-3.5" style={{ backgroundColor: 'var(--c-accent-tint-2)' }} />
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Assign</button>
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Set status</button>
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Set priority</button>
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Add tag</button>
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Merge</button>
      <button className="text-[12px] px-2 py-0.5 rounded border bg-white" style={{ borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Apply macro…</button>
      <span className="flex-1" />
      <button onClick={onClear} className="text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
        <span className="font-mono text-[10px] px-1 rounded-sm border" style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}>Esc</span>
        {' '}to clear
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create `TicketsTable.tsx`**

```tsx
import { useState } from 'react';
import { Pill, Prio, Avatar, SlaBar, Icn, I } from '../atoms';
import type { MockTicket } from './mock-tickets';

interface TicketsTableProps {
  tickets: MockTicket[];
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onRowClick?: (id: string) => void;
}

export function TicketsTable({ tickets, selected, onSelectionChange, onRowClick }: TicketsTableProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const allChecked = tickets.length > 0 && tickets.every(t => selected.has(t.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const toggleAll = () => {
    if (allChecked) onSelectionChange(new Set());
    else onSelectionChange(new Set(tickets.map(t => t.id)));
  };

  return (
    <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--c-surface)' }}>
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ color: 'var(--c-fg-4)', backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 28 }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
            </th>
            <th className="border-b sticky top-0" style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 18 }} />
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ color: 'var(--c-fg-4)', backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 88 }}>ID</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ color: 'var(--c-fg-4)', backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)' }}>Subject</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ color: 'var(--c-fg-4)', backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 150 }}>Customer</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ color: 'var(--c-fg-4)', backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 110 }}>Status</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ color: 'var(--c-fg-4)', backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 90 }}>Team</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ color: 'var(--c-fg-4)', backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 88 }}>Assignee</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ color: 'var(--c-fg-4)', backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 140 }}>SLA</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] py-1.5 px-2.5 border-b sticky top-0" style={{ color: 'var(--c-fg-4)', backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 70 }}>Updated</th>
            <th className="border-b sticky top-0" style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', width: 24 }} />
          </tr>
        </thead>
        <tbody>
          {tickets.map(t => {
            const isSelected = selected.has(t.id);
            const isHover = hovered === t.id;
            const rowBg = isSelected ? 'var(--c-accent-tint)' : isHover ? 'var(--c-surface-2)' : 'transparent';
            return (
              <tr
                key={t.id}
                onMouseEnter={() => setHovered(t.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onRowClick?.(t.id)}
                className="cursor-pointer"
              >
                <td className="py-1.5 px-2.5 border-b" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)' }} onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggle(t.id)} aria-label={`Select ${t.id}`} />
                </td>
                <td className="py-1.5 px-2.5 border-b" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)' }}>
                  <Prio level={t.priority} />
                </td>
                <td className="py-1.5 px-2.5 border-b font-mono text-[11px]" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)', color: 'var(--c-fg-4)' }}>
                  {t.id}
                </td>
                <td className="py-1.5 px-2.5 border-b" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)' }}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate font-medium flex-1" style={{ color: 'var(--c-fg)' }}>{t.subject}</span>
                    {t.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-px rounded-sm flex-none" style={{ backgroundColor: 'var(--c-surface-3)', color: 'var(--c-fg-3)' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-1.5 px-2.5 border-b" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)' }}>
                  <div className="truncate" style={{ maxWidth: 140 }}>{t.customer}</div>
                  <div className="font-mono text-[10px]" style={{ color: 'var(--c-fg-4)' }}>{t.customerId}</div>
                </td>
                <td className="py-1.5 px-2.5 border-b" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)' }}>
                  <Pill tone={t.statusTone} dot>{t.status}</Pill>
                </td>
                <td className="py-1.5 px-2.5 border-b text-[12px]" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)', color: 'var(--c-fg-3)' }}>
                  {t.team}
                </td>
                <td className="py-1.5 px-2.5 border-b" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)' }}>
                  <div className="flex items-center gap-1.5">
                    <Avatar name={t.assigneeInitials} size="sm" tone={t.assigneeTone} />
                    <span className="text-[11px]">@{t.assigneeInitials}</span>
                  </div>
                </td>
                <td className="py-1.5 px-2.5 border-b" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)' }}>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-[60px]"><SlaBar pct={t.sla.pct} state={t.sla.state} /></div>
                    <span
                      className="font-mono text-[11px] font-semibold w-[50px] text-right"
                      style={{
                        color:
                          t.sla.state === 'breach' ? 'var(--c-red)' :
                          t.sla.state === 'warn'   ? 'var(--c-amber)' :
                                                     'var(--c-fg-3)',
                      }}
                    >{t.sla.text}</span>
                  </div>
                </td>
                <td className="py-1.5 px-2.5 border-b font-mono text-[11px]" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)', color: 'var(--c-fg-4)' }}>
                  {t.updated}
                </td>
                <td className="py-1.5 px-2.5 border-b" style={{ backgroundColor: rowBg, borderColor: 'var(--c-divider)' }}>
                  <button onClick={e => e.stopPropagation()} aria-label="More actions">
                    <Icn d={I.more} s={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Create `TicketsPageRevamp.tsx`** — the page composing everything.

```tsx
import { useState } from 'react';
import { AppShell } from '../components/shell/AppShell';
import { Pill, Icn, I } from '../components/atoms';
import { FilterChip } from '../components/tickets/FilterChip';
import { BulkActionBar } from '../components/tickets/BulkActionBar';
import { TicketsTable } from '../components/tickets/TicketsTable';
import { MOCK_TICKETS } from '../components/tickets/mock-tickets';

export default function TicketsPageRevamp() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState([
    { label: 'status',   value: 'open, in_progress', active: true  },
    { label: 'priority', value: 'P1, P2',            active: false },
    { label: 'assignee', value: 'me',                active: false },
    { label: 'tier',     value: 'enterprise',        active: false },
  ]);

  return (
    <AppShell crumbs={['Inbox', 'All open']}>
      {/* Page header */}
      <div className="px-4.5 py-3 border-b" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', padding: '12px 18px' }}>
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[18px] font-semibold tracking-[-0.01em]">All open</h1>
            <Pill tone="gray"><span className="font-mono">{MOCK_TICKETS.length}</span></Pill>
            <span className="text-[11px]" style={{ color: 'var(--c-fg-4)' }}>· updated <span className="font-mono">14:32</span></span>
          </div>
          <div className="flex gap-1.5">
            <button className="text-[11px] px-1.5 py-1 rounded border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Save view</button>
            <button className="text-[11px] px-1.5 py-1 rounded border inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Export <Icn d={I.chevD} s={11} /></button>
            <button className="text-[11px] px-1.5 py-1 rounded inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-accent)', color: 'white' }}>
              <Icn d={I.plus} s={11} /> New ticket
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {filters.map((f, i) => (
            <FilterChip
              key={f.label}
              label={f.label}
              value={f.value}
              active={f.active}
              onRemove={() => setFilters(filters.filter((_, j) => j !== i))}
            />
          ))}
          <button className="text-[11px] px-1.5 py-1 rounded inline-flex items-center gap-1 border-dashed border" style={{ color: 'var(--c-fg-3)', borderColor: 'var(--c-border-strong)' }}>
            <Icn d={I.plus} s={11} /> Add filter
          </button>
          <span className="flex-1" />
          <button className="text-[11px] px-1.5 py-1 rounded border inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>
            Group · <span className="font-semibold">None</span> <Icn d={I.chevD} s={11} />
          </button>
          <button className="text-[11px] px-1.5 py-1 rounded border inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>
            Sort · <span className="font-semibold">SLA ↓</span> <Icn d={I.chevD} s={11} />
          </button>
        </div>
      </div>

      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())} />

      <TicketsTable
        tickets={MOCK_TICKETS}
        selected={selected}
        onSelectionChange={setSelected}
        onRowClick={(id) => console.log('row clicked', id)}
      />

      {/* Footer */}
      <div
        className="flex items-center justify-between text-[11px] py-1.5 px-4.5 border-t"
        style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-fg-4)', padding: '6px 18px' }}
      >
        <div className="font-mono">Showing 1–{MOCK_TICKETS.length} of 142</div>
        <div className="flex items-center gap-1.5">
          <span>
            <span className="font-mono text-[10px] px-1 rounded-sm border" style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}>J</span>
            <span className="font-mono text-[10px] px-1 rounded-sm border" style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}>K</span>
            {' '}nav ·{' '}
            <span className="font-mono text-[10px] px-1 rounded-sm border" style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}>X</span>
            {' '}select ·{' '}
            <span className="font-mono text-[10px] px-1 rounded-sm border" style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}>E</span>
            {' '}assign
          </span>
          <span className="w-px h-3.5" style={{ backgroundColor: 'var(--c-border)' }} />
          <button className="text-[11px] px-1.5 py-0.5 rounded border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>‹</button>
          <span className="font-mono">1 / 12</span>
          <button className="text-[11px] px-1.5 py-0.5 rounded border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>›</button>
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 6: Add a temporary route in `App.tsx`**

Open `apps/web/src/App.tsx`. Find the existing `<Routes>` block. Add this route alongside the existing tickets route:

```tsx
import TicketsPageRevamp from './pages/TicketsPageRevamp';
// ...
<Route path="/tickets-revamp" element={<TicketsPageRevamp />} />
```

(Place it inside the same authenticated route group as `/tickets`.)

- [ ] **Step 7: Visual review**

Run `npm run dev -w apps/web`. Navigate to `http://localhost:5173/tickets-revamp`.

Compare against the design's `Ticketing System v2 - Refined.html` in browser side-by-side.

**Pixel-targets to match:**
- 224px sidebar width, 40px topbar height
- Indigo active state on sidebar nav rows
- Filter chips with rounded 3px corners, indigo tint when active
- Table row height ~28-32px (use the design's reference HTML to verify)
- Priority bar = 3 colored vertical bars (4/8/12px)
- SLA bar = 4px tall, color matches state
- All numerals in IBM Plex Mono with tabular-nums

If the table feels wrong density, inspect a row's computed height in DevTools and check against the design's reference. Adjust `py-1.5` to `py-1` if needed.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/src/components/tickets/ apps/web/src/pages/TicketsPageRevamp.tsx apps/web/src/App.tsx
git commit -m "feat(ui): tickets list revamp with mock data on /tickets-revamp"
```

---

## Task 5: Wire Tickets List to real API + retire `/tickets-revamp` preview route

**Files:**
- Modify: `apps/web/src/components/tickets/TicketsTable.tsx` (accept generic ticket shape)
- Modify: `apps/web/src/pages/TicketsPage.tsx` (replace existing implementation with the revamp)
- Delete: `apps/web/src/pages/TicketsPageRevamp.tsx` (merge into TicketsPage)
- Modify: `apps/web/src/App.tsx` (remove the `/tickets-revamp` route, restore `/tickets` as the canonical path)

**Goal:** The new design renders against real ticket data from the existing tanstack-query hook(s). Mock data is gone; URL `/tickets` shows the new list.

The implementer should first **read** the existing `TicketsPage.tsx` to understand:
- Which tanstack-query hook fetches tickets (likely `useTickets` or similar in `apps/web/src/api/`)
- What shape the API ticket has (look at `apps/web/src/types.ts` and the API source)
- How filters / pagination are encoded into URL or query state

Then build a small adapter `apps/api/src/types.ts → MockTicket-like` or change `TicketsTable` to accept the API shape directly.

- [ ] **Step 1: Read the existing data layer**

Open and skim:
- `apps/web/src/pages/TicketsPage.tsx`
- `apps/web/src/types.ts` (Ticket type)
- `apps/web/src/api/` (relevant fetch hooks)
- `apps/web/src/components/TicketTableView.tsx` (current implementation — may have useful patterns for SLA computation, sorting, etc.)

Take note of:
- The `Ticket` type's fields (likely `id`, `subject`, `priority`, `status`, `assignee`, `team`, `requester`, `sla` info, `updatedAt`)
- How priority + status enums map to the design's pill tones (e.g., `WAITING_ON_REQUESTER` → blue, `RESOLVED` → green)
- How SLA percent + state are computed (probably from `dueAt` + `firstResponseDueAt`)

- [ ] **Step 2: Add mappers in a new `apps/web/src/components/tickets/mappers.ts`**

Map the API's `Ticket` → the table's expected shape. Implementation depends on what you found in Step 1; example signature:

```ts
import type { Ticket } from '../../types';
import type { PrioLevel } from '../atoms';

export interface TicketRow {
  id: string;                    // displayId or number-prefixed
  subject: string;
  customer: string;
  customerId: string;
  priority: PrioLevel;
  status: string;
  statusTone: 'red' | 'amber' | 'green' | 'blue' | 'gray' | 'purple';
  team: string;
  assigneeInitials: string;
  assigneeTone: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
  sla: { pct: number; state: 'ok' | 'warn' | 'breach'; text: string };
  updated: string;
  tags: string[];
}

const STATUS_TONE: Record<string, 'red' | 'amber' | 'green' | 'blue' | 'gray' | 'purple'> = {
  NEW:                 'gray',
  TRIAGED:             'gray',
  ASSIGNED:            'amber',
  IN_PROGRESS:         'amber',
  WAITING_ON_REQUESTER:'blue',
  WAITING_ON_VENDOR:   'blue',
  RESOLVED:            'green',
  CLOSED:              'green',
  REOPENED:            'red',
};

export function ticketToRow(t: Ticket): TicketRow {
  // Adjust property paths after reading the actual Ticket type.
  // ... compute SLA pct, state, text from t.firstResponseDueAt / t.dueAt ...
  // ... compute assigneeInitials from t.assignee.displayName ...
  // ... return TicketRow ...
}
```

(The implementer should fill in the property accesses after reading the actual `Ticket` type. Don't ship a stub.)

- [ ] **Step 3: Update `TicketsTable.tsx` to accept `TicketRow` instead of `MockTicket`**

In `TicketsTable.tsx`, replace the import:

```tsx
import type { MockTicket } from './mock-tickets';
```

with:

```tsx
import type { TicketRow } from './mappers';
```

And replace `MockTicket` with `TicketRow` throughout the file. The shapes are identical so no other code changes.

- [ ] **Step 4: Replace `TicketsPage.tsx` with the revamp content**

The new `TicketsPage.tsx`:

```tsx
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '../components/shell/AppShell';
import { Pill, Icn, I } from '../components/atoms';
import { FilterChip } from '../components/tickets/FilterChip';
import { BulkActionBar } from '../components/tickets/BulkActionBar';
import { TicketsTable } from '../components/tickets/TicketsTable';
import { ticketToRow } from '../components/tickets/mappers';
// ... import the existing useTickets hook (whatever it's named in apps/web/src/api/)

export default function TicketsPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Use existing tickets fetching hook
  const { data: ticketsData, isLoading } = useQuery({ /* spread existing query options */ });

  const rows = useMemo(
    () => (ticketsData?.items ?? []).map(ticketToRow),
    [ticketsData]
  );

  return (
    <AppShell crumbs={['Inbox', 'All open']}>
      {/* ... header, filters, table — identical to TicketsPageRevamp.tsx ... */}
    </AppShell>
  );
}
```

Copy the JSX body from `TicketsPageRevamp.tsx` into the new `TicketsPage.tsx`, swapping `MOCK_TICKETS` for `rows`. Add a loading skeleton state (use existing `apps/web/src/components/skeletons/` if that folder has one suitable).

- [ ] **Step 5: Delete the preview route**

Delete `apps/web/src/pages/TicketsPageRevamp.tsx`. In `apps/web/src/App.tsx`, remove the `/tickets-revamp` route + its import.

- [ ] **Step 6: Visual + functional verify**

Run dev server. Navigate to `/tickets`. Expected:
- Real ticket data from your API
- Sorting by SLA descending (default)
- Click a row → navigates to ticket detail (use existing nav pattern — `useNavigate(`/tickets/${id}`)`)
- Selection checkbox triggers BulkActionBar
- Pagination footer shows real counts (`Showing X-Y of Z`)
- Table density matches the design's reference

If anything mismatches, iterate. The design's HTML reference is the source of truth.

- [ ] **Step 7: Run all tests**

```powershell
npm run test -w apps/web -- --run
```

Expected: existing tests pass; new atom tests pass. If any test relied on the old TicketsPage layout, it will need updating — note these tests but don't fix unrelated ones.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/src/pages/TicketsPage.tsx apps/web/src/components/tickets/mappers.ts apps/web/src/components/tickets/TicketsTable.tsx apps/web/src/App.tsx
git rm apps/web/src/pages/TicketsPageRevamp.tsx
git commit -m "feat(ui): wire tickets list revamp to real API; retire preview route"
```

---

## Self-Review Checklist (executor reads before starting)

- [ ] Existing dev server runs cleanly: `npm run dev -w apps/web` against your current Supabase-backed API.
- [ ] Vitest config supports `jsdom` (atom tests need DOM).
- [ ] You have read the design's `README.md` and the relevant `.jsx` references in `C:\Users\PHulgur\Downloads\Ticketing System\design_handoff_helpdesk\refs\`.
- [ ] Branch is `feat/ui-revamp`.
- [ ] You're working only on light mode for this slice; `.dark` block in `styles.css` stays untouched but unverified.

## What's deliberately NOT in this plan

- Dark mode (separate task, takes ~half of Task 1 + theming sweep through atoms).
- Other screens: Dashboard, Detail, Board, Reports, AI Submit, SLA admin (each is its own plan).
- Real-time updates / WebSocket subscription on the list.
- Keyboard navigation (J/K/X/E shortcuts) — the design shows them in the footer; wiring is a follow-up.
- Bulk action implementations (Assign / Set status / etc. dropdown menus) — UI-only for now; no real mutations.
- Column resizing or persistence of sort/filter state across page reloads.
- Existing `Sidebar.tsx`, `TicketTableView.tsx`, or other components used by other pages — they keep working unchanged for those pages.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| The `MockTicket → TicketRow` mapper doesn't quite match the real API shape | Step 1 of Task 5 explicitly mandates reading the actual type before writing the mapper |
| Existing tests break because they assume old TicketsPage layout | Run full test suite after Task 5; if breakage is unrelated, log them as follow-up; if it's our table, fix |
| `prisma generate` Windows DLL lock surfaces here too if the dev server is running | Stop the dev server before any test runs that touch Prisma client codegen |
| Tailwind purges new utility values (`p-4.5`, `text-[11px]`, etc.) | Tailwind 3.4 with arbitrary values supports these; if a value goes missing, add it explicitly to `safelist` in `tailwind.config.ts` |
| Existing pages relying on the old indigo-on-warm-ivory palette suddenly look off | Expected — the token swap is a global aesthetic shift. Other pages will be updated in subsequent revamp tasks |
