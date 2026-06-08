# Design Token Unification Spec

> Status: **proposal**. This document defines one canonical token system for the
> web app and the mechanical migration path off the three systems in use today.
> No code has changed yet — this is the map the migration follows.

---

## 1. Why this exists

The app currently has **three sources of truth for color**:

| System | Occurrences | Files | What it is |
|---|---|---|---|
| `--c-*` CSS vars | 307 | 29 | The "revamp" track. Best palette values, but a parallel namespace. |
| `hsl(var(--…))` shadcn vars | 134 | 18 | What every UI primitive and **all Recharts** consume. |
| Hardcoded hex (`#3b82f6`, …) | 152 | 22 | Duplicated chart + status colors. The reason a palette change is a 22-file edit. |
| `dk ? … : …` inline ternaries | 12 | 2 | `Sidebar.tsx` / `SidebarSavedViews.tsx` — why the two themes drift. |

The same indigo, the same status red, the same chart blue are each defined in
multiple places with slightly different values. This spec collapses all of it to
**one semantic layer**.

### Decisions

1. **Canonical layer = the shadcn `hsl(var(--…))` namespace.** It's already wired
   into Tailwind (`tailwind.config.ts`), every `ui/` primitive, and all charts.
   Migrating *to* it touches the fewest consumers.
2. **Adopt the `--c-*` revamp _values_** (they're better tuned) but expose them
   *through* the shadcn variable names. Then delete the `--c-*` namespace.
3. **One brand hue across both themes** — indigo. No more cyan-in-dark / indigo-in-light flip.
4. **All hardcoded hex and `dk ?` ternaries get replaced** by token references.
5. Tokens are stored as **space-separated HSL channels** (`232 57% 41%`) so
   Tailwind's `hsl(var(--x) / <alpha>)` opacity modifier keeps working.

---

## 2. Canonical token set

Naming convention: `--<group>-<role>`. Tailwind utility in the right column.

### 2.1 Surfaces

| Token | Light | Dark | Tailwind | Replaces |
|---|---|---|---|---|
| `--background` | `#f6f7f9` | `#0b1018` | `bg-background` | `--c-bg`, body bg |
| `--surface` | `#ffffff` | `#121a26` | `bg-surface` | `--c-surface`, `--card` |
| `--surface-raised` | `#fafbfc` | `#16202e` | `bg-surface-raised` | `--c-surface-2`, `--popover` |
| `--surface-sunken` | `#f1f3f5` | `#0e1622` | `bg-surface-sunken` | `--c-surface-3`, `--secondary` |
| `--border` | `#e3e6ea` | `#26303f` | `border-border` | `--c-border`, `--border` |
| `--border-strong` | `#ced2d8` | `#33404f` | `border-border-strong` | `--c-border-strong`, `--input` |
| `--divider` | `#eceff2` | `#1c2532` | `border-divider` | `--c-divider` |

> Keep the legacy aliases `--card`, `--popover`, `--secondary`, `--muted`,
> `--input` as **pointers** to the new tokens during migration (e.g.
> `--card: var(--surface)`), then inline-and-delete once consumers are migrated.

### 2.2 Text / foreground

| Token | Light | Dark | Tailwind | Replaces |
|---|---|---|---|---|
| `--fg` | `#0f1419` | `#e8ecf2` | `text-fg` | `--c-fg`, `--foreground` |
| `--fg-secondary` | `#2b3340` | `#c2cad6` | `text-fg-secondary` | `--c-fg-2` |
| `--fg-muted` | `#5c6573` | `#8a94a3` | `text-fg-muted` | `--c-fg-3`, `--muted-foreground` |
| `--fg-subtle` | `#6b7280` | `#6b7686` | `text-fg-subtle` | `--c-fg-4`, `#94a3b8`, `#64748b` |
| `--fg-faint` | `#8a92a0` | `#525c6b` | `text-fg-faint` | `--c-fg-5` |

> **Accessibility floor:** `--fg-muted` is the *lightest* token allowed for any
> text that must be read. The current `text-white/28` / `text-white/40` sidebar
> states fall below AA — they map to `--fg-faint` only for decorative/idle glyphs,
> never for labels. Verify each at ≥4.5:1 against its surface during migration.

### 2.3 Brand / accent (indigo — both themes)

| Token | Light | Dark | Tailwind | Replaces |
|---|---|---|---|---|
| `--accent` | `#2d3da3` | `#5468e0` | `bg-accent` / `text-accent` | `--c-accent`, `--primary`, `#6366f1` |
| `--accent-hover` | `#3b50c4` | `#6a7cf0` | `bg-accent-hover` | `--c-accent-2`, `#4f46e5` |
| `--accent-fg` | `#ffffff` | `#0b1018` | `text-accent-fg` | `--primary-foreground` |
| `--accent-tint` | `#eef0fb` | `#1b2240` | `bg-accent-tint` | `--c-accent-tint`, `--accent` |
| `--accent-tint-strong` | `#dde1f5` | `#252e52` | `bg-accent-tint-strong` | `--c-accent-tint-2` |
| `--ring` | `var(--accent)` | `var(--accent)` | `ring-ring` | `--ring` |

> **Retire the cyan `brand.*` scale** (`#14d4f4`, …) in `tailwind.config.ts` and
> the dark-mode cyan `--primary`. The brand mark gradient in `Sidebar.tsx:74`
> becomes a single indigo gradient for both themes.

### 2.4 Status / semantic (one definition, used by pills, badges, AND charts)

Each status has a **solid** (text/icon/chart) and a **tint** (background) value.

| Status | Solid (light) | Tint (light) | Solid (dark) | Tint (dark) | Tailwind |
|---|---|---|---|---|---|
| `--status-red` (error/overdue) | `#b42318` | `#fdecec` | `#f87171` | `#2a1414` | `text-status-red` / `bg-status-red-tint` |
| `--status-amber` (warning/at-risk) | `#b54708` | `#fdf3e7` | `#fbbf24` | `#2a1e0e` | `text-status-amber` / `bg-status-amber-tint` |
| `--status-green` (resolved/ok) | `#1d7a4d` | `#e7f5ee` | `#34d399` | `#0e2419` | `text-status-green` / `bg-status-green-tint` |
| `--status-blue` (open/info) | `#1454a8` | `#e6eef9` | `#60a5fa` | `#0e1e33` | `text-status-blue` / `bg-status-blue-tint` |
| `--status-purple` (new) | `#6b3aa3` | `#f1ebf9` | `#a78bfa` | `#1d142e` | `text-status-purple` / `bg-status-purple-tint` |
| `--status-neutral` (closed/idle) | `#5c6573` | `#f1f3f5` | `#8a94a3` | `#16202e` | `text-status-neutral` / `bg-status-neutral-tint` |

This single set replaces:
- `--c-red/amber/green/blue/purple` (+ `-tint`)
- the separate `--status-new/open/progress/resolved/waiting` (+`-bg`) HSL set
- the hardcoded status hex in `atoms/Pill.tsx`, `atoms/Avatar.tsx`,
  `atoms/Prio.tsx`, `atoms/SlaBar.tsx`, `SidebarSavedViews.tsx`.

### 2.5 Chart palette

Charts must reference status/accent tokens, not raw hex. Define an explicit
ordered series so categorical charts stay consistent:

| Token | Maps to | Replaces hardcoded |
|---|---|---|
| `--chart-1` | `var(--accent)` | `#3b82f6`, `#6366f1` |
| `--chart-2` | `var(--status-green)` | `#22c55e` |
| `--chart-3` | `var(--status-amber)` | `#f59e0b`, `#d97706`, `#fb923c` |
| `--chart-4` | `var(--status-red)` | `#ef4444` |
| `--chart-5` | `var(--status-purple)` | `#8b5cf6`, `#a855f7` |
| `--chart-6` | `var(--status-blue)` | `#06b6d4` |
| `--chart-grid` | `var(--divider)` | `#e5e7eb`, `#cbd5e1` |

> `DashboardPage.tsx` alone hardcodes this palette **three times** (lines ~333,
> ~605). After migration it imports one `CHART_COLORS` array built from
> `getComputedStyle` on these vars (or a small `chart-tokens.ts` constant).

### 2.6 Elevation, radius, motion

| Token | Value | Notes |
|---|---|---|
| `--radius` | `6px` | up from 4px; one scale: `sm 4 / md 6 / lg 8`. Avatars/pills stay `rounded-full`. |
| `--shadow-sm` | light: `0 1px 2px rgb(15 20 25 / .04)` · dark: `0 1px 2px rgb(0 0 0 / .4)` | per-theme via var |
| `--shadow-md` | light: `0 1px 3px rgb(15 20 25 / .06), 0 6px 24px rgb(15 20 25 / .05)` | replaces `shadow-card` |
| `--shadow-lg` | light: `0 4px 16px …, 0 20px 50px …` | replaces `shadow-elevated` |

> **Fix:** `tailwind.config.ts` `boxShadow` currently hardcodes *dark-only*
> black-alpha shadows, so `shadow-card` is too heavy in light mode. Route the
> Tailwind `boxShadow` keys through these CSS vars instead of literal values.
> **Drop** the `glow`/`glow-sm`/`glow-cyan*` neon effects entirely.

### 2.7 Typography (token-ize the existing helpers)

Keep the `.heading-*` / `.body-*` helpers but pin them to one scale and cut the
ALL-CAPS default:

| Class | Size / weight | Change |
|---|---|---|
| `text-2xs` | 11px | for true eyebrow labels only |
| `text-xs` | 12px | meta |
| `text-sm` | 13px | **new base** for body (after zoom removal) |
| `text-base` | 15px | emphasis |
| `.label-text` | 12px, medium, **sentence case** | remove `uppercase tracking-widest` default |

---

## 3. The unified `:root` block (target state)

```css
:root {
  color-scheme: light;

  /* surfaces */
  --background:      220 14% 97%;   /* #f6f7f9 */
  --surface:           0  0% 100%;  /* #ffffff */
  --surface-raised:  210 20% 99%;   /* #fafbfc */
  --surface-sunken:  210 14% 95%;   /* #f1f3f5 */
  --border:          213 13% 90%;   /* #e3e6ea */
  --border-strong:   213 10% 83%;   /* #ced2d8 */
  --divider:         210 17% 94%;   /* #eceff2 */

  /* text */
  --fg:           213 26%  8%;      /* #0f1419 */
  --fg-secondary: 215 19% 21%;      /* #2b3340 */
  --fg-muted:     216 11% 41%;      /* #5c6573 */
  --fg-subtle:    220  9% 46%;
  --fg-faint:     216 11% 59%;      /* #8a92a0 */

  /* brand */
  --accent:            232 57% 41%; /* #2d3da3 */
  --accent-hover:      230 53% 50%; /* #3b50c4 */
  --accent-fg:           0  0% 100%;
  --accent-tint:       232 67% 96%; /* #eef0fb */
  --accent-tint-strong:230 60% 91%; /* #dde1f5 */
  --ring:              232 57% 41%;

  /* status — solid + tint */
  --status-red: 4 76% 40%;       --status-red-tint: 0 78% 96%;
  --status-amber: 25 87% 37%;    --status-amber-tint: 33 86% 95%;
  --status-green: 152 62% 30%;   --status-green-tint: 150 45% 93%;
  --status-blue: 211 79% 37%;    --status-blue-tint: 213 67% 94%;
  --status-purple: 270 47% 43%;  --status-purple-tint: 270 53% 95%;
  --status-neutral: 216 11% 41%; --status-neutral-tint: 210 14% 95%;

  /* charts */
  --chart-1: var(--accent);
  --chart-2: var(--status-green);
  --chart-3: var(--status-amber);
  --chart-4: var(--status-red);
  --chart-5: var(--status-purple);
  --chart-6: var(--status-blue);
  --chart-grid: var(--divider);

  --radius: 6px;

  /* legacy aliases — TEMPORARY pointers, deleted at end of migration */
  --card: var(--surface);
  --popover: var(--surface-raised);
  --secondary: var(--surface-sunken);
  --muted: var(--surface-sunken);
  --muted-foreground: var(--fg-muted);
  --primary: var(--accent);
  --primary-foreground: var(--accent-fg);
  --input: var(--border-strong);
  --foreground: var(--fg);
}

.dark {
  color-scheme: dark;
  --background: 215 30% 7%;
  --surface: 215 30% 11%;
  --surface-raised: 215 27% 13%;
  --surface-sunken: 216 33% 9%;
  --border: 215 24% 20%;
  --border-strong: 215 21% 25%;
  --divider: 215 27% 15%;
  --fg: 213 25% 92%;
  --fg-secondary: 214 20% 80%;
  --fg-muted: 215 14% 60%;
  --fg-subtle: 215 12% 52%;
  --fg-faint: 215 14% 40%;
  --accent: 232 67% 60%;       /* indigo, lifted for dark — NOT cyan */
  --accent-hover: 232 73% 67%;
  --accent-fg: 215 30% 7%;
  --accent-tint: 232 40% 18%;
  --accent-tint-strong: 232 38% 24%;
  --ring: 232 67% 60%;
  /* status dark solids/tints per §2.4 … */
}
```

---

## 4. Migration map (old → new)

### `--c-*` → shadcn token
| Old | New |
|---|---|
| `var(--c-bg)` | `hsl(var(--background))` |
| `var(--c-surface)` | `hsl(var(--surface))` |
| `var(--c-surface-2)` | `hsl(var(--surface-raised))` |
| `var(--c-surface-3)` | `hsl(var(--surface-sunken))` |
| `var(--c-border)` | `hsl(var(--border))` |
| `var(--c-border-strong)` | `hsl(var(--border-strong))` |
| `var(--c-divider)` | `hsl(var(--divider))` |
| `var(--c-fg)` | `hsl(var(--fg))` |
| `var(--c-fg-2..5)` | `--fg-secondary` / `--fg-muted` / `--fg-subtle` / `--fg-faint` |
| `var(--c-accent)` / `-2` | `--accent` / `--accent-hover` |
| `var(--c-accent-tint)` / `-2` | `--accent-tint` / `--accent-tint-strong` |
| `var(--c-red…purple)` (+`-tint`) | `--status-*` (+`-tint`) |

### Hardcoded hex → token
| Old hex | New |
|---|---|
| `#3b82f6`, `#6366f1`, `#2563eb` | `--accent` / `--chart-1` |
| `#22c55e` | `--status-green` / `--chart-2` |
| `#f59e0b`, `#d97706`, `#fb923c`, `#fbbf24` | `--status-amber` / `--chart-3` |
| `#ef4444` | `--status-red` / `--chart-4` |
| `#8b5cf6`, `#a855f7`, `#7c3aed` | `--status-purple` / `--chart-5` |
| `#06b6d4`, `#14d4f4` | `--status-blue` / `--chart-6` (cyan retired) |
| `#e5e7eb`, `#cbd5e1` | `--chart-grid` / `--divider` |
| `#94a3b8`, `#64748b` | `--fg-subtle` |
| `Pill/Avatar/Prio/SlaBar` status hex | matching `--status-*` |

> **Exempt:** `SignInLandingPage.tsx:243-246` (`#F25022 #7FBA00 #00A4EF #FFB900`)
> is the **Microsoft logo** — brand-locked, leave as-is. Mark with a comment.

### `dk ? a : b` ternaries
`Sidebar.tsx` (9) + `SidebarSavedViews.tsx` (3): delete every ternary; the value
comes from the token, which already differs per theme via the `.dark` block.
Net: the components stop knowing which theme is active.

---

## 5. Tailwind config changes

```ts
// tailwind.config.ts — colors block
colors: {
  background: 'hsl(var(--background) / <alpha-value>)',
  surface: {
    DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
    raised:  'hsl(var(--surface-raised) / <alpha-value>)',
    sunken:  'hsl(var(--surface-sunken) / <alpha-value>)',
  },
  fg: {
    DEFAULT:   'hsl(var(--fg) / <alpha-value>)',
    secondary: 'hsl(var(--fg-secondary) / <alpha-value>)',
    muted:     'hsl(var(--fg-muted) / <alpha-value>)',
    subtle:    'hsl(var(--fg-subtle) / <alpha-value>)',
    faint:     'hsl(var(--fg-faint) / <alpha-value>)',
  },
  accent: {
    DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
    hover:   'hsl(var(--accent-hover) / <alpha-value>)',
    fg:      'hsl(var(--accent-fg) / <alpha-value>)',
    tint:    'hsl(var(--accent-tint) / <alpha-value>)',
  },
  status: {
    red:    'hsl(var(--status-red) / <alpha-value>)',
    amber:  'hsl(var(--status-amber) / <alpha-value>)',
    green:  'hsl(var(--status-green) / <alpha-value>)',
    blue:   'hsl(var(--status-blue) / <alpha-value>)',
    purple: 'hsl(var(--status-purple) / <alpha-value>)',
    neutral:'hsl(var(--status-neutral) / <alpha-value>)',
  },
  border: { DEFAULT: 'hsl(var(--border))', strong: 'hsl(var(--border-strong))' },
  ring: 'hsl(var(--ring))',
  chart: { 1:'hsl(var(--chart-1))', /* …6 */ },
  // DELETE: brand.* cyan scale
},
boxShadow: {
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
  // DELETE: glow, glow-sm, soft-lg
},
```

---

## 6. Rollout (mechanical, low-risk order)

1. **Add the canonical `:root` / `.dark` blocks** + legacy aliases (§3). Nothing
   breaks — old shadcn vars now point at new values, app re-skins in place.
2. **Update Tailwind config** (§5), keeping old keys until consumers move.
3. **Migrate `--c-*` files** (29 files, §4) with find-and-replace per the map.
   Delete the `--c-*` definitions from `styles.css` when the grep count hits 0.
4. **Replace hardcoded hex** (22 files). Start with the atoms
   (`Pill/Avatar/Prio/SlaBar`) — highest reuse — then charts, then pages.
5. **Centralize chart colors** into `chart-tokens.ts`; gut the 3 inline palettes
   in `DashboardPage.tsx` and the ones in `ManagerViewsPage.tsx`.
6. **De-ternary the sidebars** (§4) and drop `glow-*`.
7. **Delete legacy aliases** (`--card`, `--primary`, …) once grep shows no
   `hsl(var(--card))`-style consumers remain.

### Definition of done
- `grep -r "--c-"` → 0 · `grep -r "#[0-9a-f]{6}"` in `src/` → only the MS logo.
- `grep -r "dk ?"` → 0.
- Every status color, chart color, and surface resolves to exactly one token.
- AA contrast verified on all text tokens against their surfaces.
- Theme switch changes only token values — zero component-level theme branches.
```
