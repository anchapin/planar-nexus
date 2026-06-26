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
