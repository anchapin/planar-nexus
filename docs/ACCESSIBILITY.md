# Accessibility (a11y) Conventions

This document captures the conventions used across Planar Nexus to keep the UI
accessible. It is the reference for issue #1101 and future a11y work.

## Icon-only buttons

Any `<Button>` whose only visible content is an icon (no text label) **must**
expose a programmatically determinable accessible name, per
[WCAG 2.1 SC 4.1.2 (Name, Role, Value)](https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html).

### Rule

- Add an `aria-label` to every `<Button size="icon">` (or any button whose
  children are only icons). The shadcn `Button` forwards all extra props to the
  underlying `<button>`, so `aria-label` passes through automatically.
- Prefer `aria-label` over `title`. A `title` attribute renders a tooltip but is
  **not** a reliable accessible name across browsers/screen readers. If a
  tooltip is also desired, keep `title` alongside `aria-label`.
- Labels must be **action-oriented and descriptive** (e.g. `"Add card"`,
  `"Decrease life"`, `"Open chat"`), never generic (`"button"`, `"icon"`).
- When a button's action depends on state, make the label dynamic
  (e.g. `aria-label={isHidden ? "Show spectators" : "Hide spectators"}`).
- Where the component already uses the i18n `t()` helper, pass the translated
  string: `aria-label={t("openChat")}`.

### Examples

```tsx
// Good — icon-only button with an accessible name
<Button variant="outline" size="icon" onClick={onAdd} aria-label="Increase quantity">
  <Plus className="h-4 w-4" />
</Button>

// Good — dynamic label reflecting toggle state
<Button variant="ghost" size="icon" onClick={onToggleVisibility}
  aria-label={isHidden ? "Show spectators" : "Hide spectators"}>
  {isHidden ? <EyeOff /> : <Eye />}
</Button>

// Good — tooltip kept, accessible name explicit
<Button variant="ghost" size="icon" onClick={onOpenSettings}
  aria-label={t("settings")} title={t("settings")}>
  <Settings />
</Button>
```

### Testing

Component tests assert accessible names using Testing Library's role queries,
which resolve the accessible name the same way a screen reader does:

```tsx
expect(
  screen.getByRole("button", { name: "Increase quantity" }),
).toBeInTheDocument();
```

See `src/components/__tests__/icon-button-a11y.test.tsx` for representative
coverage of the icon-only buttons in `SpectatorView`, `LifeAdjustment`, and
`CounterAdjustment`.

## Forced colors / Windows High Contrast Mode

Users on Windows High Contrast Mode, OS-level Contrast Boost, or browsers in
forced-colors mode lose the author-supplied color palette. Anything that
conveys game state through translucent gradients, opacity layering, or muted
borders disappears. Game chrome must remain usable in this mode.

### Rule

- **Color-only state is forbidden** as the sole signal: every state that
  carries information (selected, hovered, damaged, priority-passed, picking,
  warning, reconnecting) must also include either an `outline`, a `border`,
  an icon swap, or text. Components set a `data-state` / `data-*-state`
  attribute and a `border` class so the global CSS rule can promote them to
  system colors.
- **Translucent utility classes** (`bg-primary/5`, `border-muted-foreground/30`,
  `bg-amber-100`, `bg-black/50`, etc.) are remapped to solid system colors
  inside the `@media (forced-colors: active)` block in `src/app/globals.css`.
  The class names remain in source; the CSS is the system of record for
  colors. Don't fight it with inline `style={{ background }}`.
- **Dashed strokes** become invisible under HCM. The global rule promotes
  `border-dashed` to a solid stroke in `src/app/globals.css`. Where a
  component depends on the dashed look for semantic meaning (e.g. zone
  separators), the global rule + border color is sufficient.
- **Component authors** add `data-hcm-affordance` on surfaces that should
  receive the `Highlight`-backed outline ring while they are informationally
  relevant (e.g. the timer during its warning phase, the connection overlay).
  The rule is keyed off this attribute so we don't outline every border in
  the world.
- **Opting out** is rare; when intentional, set `forced-color-adjust: none`
  on the affected element only (e.g. custom card art with embedded brand
  colors that must survive HCM). Document the choice with a code comment.

### System colors used

| Token        | Purpose                                    |
| ------------ | ------------------------------------------ |
| `Canvas`     | Default surface (page, cards)              |
| `CanvasText` | Default text + the substitute border color |
| `ButtonFace` | Chrome surfaces (panels, badges, progress) |
| `ButtonText` | Labels paired with `ButtonFace`            |
| `LinkText`   | Interactive references                     |
| `Highlight`  | Focus rings, picking/active state outlines |
| `GrayText`   | Disabled / muted text                      |

See https://www.w3.org/TR/css-color-4/#css-system-colors for the canonical
CSS Color 4 list.

### Inspecting in DevTools

Open Chrome DevTools → Rendering → "Emulate CSS media feature
`forced-colors`" → `active`. The page should look unchanged at a low level
(translucent layers turn solid) but interactive surfaces and progress
bars should retain a visible `Highlight` outline and solid border.

### Testing

- Component tests: `src/components/__tests__/forced-colors-game-chrome.test.tsx`
  verifies that each indicator exposes the markup the CSS rule needs
  (`data-state`, persistent `border`, accessible role).
- E2E: `e2e/forced-colors.spec.ts` runs `/single-player`, `/draft`, and
  `/multiplayer/host` with `page.emulateMedia({ forcedColors: "active" })`
  and asserts the pages hydrate and chrome controls stay focusable.

### Adding new chrome

When adding a new component to game chrome (zones, stacks, priority-passed
indicators, mana pip rows, etc.), add it to the next entry of the table
above with the `data-state` value(s) and the CSS classes you need the global
HCM block to override. A single PR per new chrome entry keeps the rule
maintainable.

## Live regions for dynamic game state

Any game-state transition that screen-reader users must perceive (turn swap,
phase change, priority passing, life totals) is published through a polite
`aria-live` region next to the board. The component is
`<GameAnnouncer>` (`src/components/game-announcer.tsx`, issue #1267) and the
existing visual live region in `game-board.tsx` is intentionally kept for
the "It is X's turn" line — both co-exist, both speak, screen-readers pick
the newer one when they overlap.

Rules of the road:

- **Polite, not assertive.** Use `aria-live="polite"` so the screen-reader
  finishes whatever else it's reading. Reserve `role="alert"` for
  irreversible, blocking events (player eliminated, game ended).
- **Throttle.** The announcer caps at one update per 750 ms. If you call
  `announce()` five times in a tick, only the first surfaces immediately and
  the rest are queued at one-per-throttle-window. Don't bypass this from
  custom code — `useGameAnnouncer().announce()` already routes through the
  throttle.
- **Dedup identical text.** Calling `announce("X")` repeatedly produces a
  single spoken "X". This prevents replacement-effect churn during damage
  resolution from spamming the live region.
- **User-facing strings.** Announcements are written so a non-MTG expert
  can follow ("Opponent gains 3 life (now 23)", not
  "PLAYER_2.life += 3"). When adding new transitions, ship the user-facing
  sentence alongside the engine event.

### Manual smoke checklist (NVDA / VoiceOver)

Run these before shipping any change that touches game-state flow:

- [ ] **NVDA + Firefox (Windows):** Start a single-player game, advance the
      phase with the spacebar. NVDA should announce
      `Now in <phase>` within the throttle window (≈1 s). Verify a second
      announcement lands after a `passPriority` click without overlap.
- [ ] **VoiceOver + Safari (macOS):** Use VO+Shift+Down to step through the
      game board. The "game-announcer" element (DataTestId) should be
      reported as `polite live region`. Each manual "advance phase" action
      should re-spoke.
- [ ] **Turn swap:** End the local turn (or trigger the AI to take its turn).
      The announcer should speak `Your turn — <phase>` / `Opponent's turn —
    <phase>`. The "you" pronoun is the contract; if the engine reports a
      generic name (`"Player 1"`), the announcer falls back to the literal
      name and emits `Player 1's turn — <phase>`.
- [ ] **Life total:** Deal 5 damage to either player. The local player
      expects `You loses 5 life (now <X>)`; an opponent expects
      `Opponent loses 5 life (now <X>)`. Sub-1 deltas are intentionally
      silent — confirm that a 0-delta replacement-effect tick does NOT
      produce an announcement.
- [ ] **Priority flip:** Pass priority twice in a row. The announcer should
      speak `Opponent has priority` and then `You have priority`. The pair
      must NOT overlap on the live region (visible in the rendered HTML
      mid-flight if you `Inspect > Elements`).
- [ ] **Reset:** Refresh the page (or hit "New game"). The first phase
      transition in the new game must produce a fresh announcement; the
      announcer must NOT carry over a stale message from the previous game.
- [ ] **Forced colors mode:** With Chrome DevTools `forced-colors` set to
      `active`, the live region remains visually hidden (sr-only) but
      continues to receive `aria-live` updates. If a regression makes the
      region visible, file an a11y bug — it must not steal focus or paint a
      background.

Automated coverage that mirrors this checklist lives in
`src/components/__tests__/game-announcer.test.tsx` — keep those tests in
sync when changing anything in this section.
