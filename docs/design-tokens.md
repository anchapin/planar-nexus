# Design tokens

This document is the canonical reference for the color tokens declared in
`src/app/globals.css`. Every documented pair has been audited against
WCAG 2.1 AA contrast minimums:

- **Text** — WCAG 1.4.3: normal text ≥ 4.5:1, large text (≥ 18pt or ≥ 14pt
  bold) ≥ 3:1.
- **Non-text UI affordance** — WCAG 1.4.11: visual information required
  to identify a component or its state (icons, borders, focus rings,
  disabled affordance) ≥ 3:1 against adjacent colors.

The audit is automated and runs in two places:

1. **CI job `a11y:contrast`** — calls `npm run a11y:contrast` which
   invokes `scripts/check-color-contrast.ts`. The job fails if any
   pair drops below threshold.
2. **Jest suite** — `src/app/__tests__/design-tokens-contrast.test.ts`
   reads `globals.css` at test time and asserts the same thresholds,
   so anyone editing tokens gets fast feedback locally.

The most recent audit report (auto-generated) is checked in as
[`CONTRAST_AUDIT.md`](./CONTRAST_AUDIT.md). Refresh it locally with:

```bash
npm run a11y:contrast:report
```

---

## Color tokens

All tokens are HSL component triples (e.g. `256 19% 19%`) so they can be
combined with Tailwind opacity modifiers via `hsl(var(--token) / <alpha>)`.

### Surfaces (backgrounds)

| Token                  | Value          | Used by                                                                                                          |
| ---------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--background`         | `256 19% 19%`  | Page surface (`bg-background`)                                                                                   |
| `--card`               | `256 19% 22%`  | Card surfaces (`bg-card`)                                                                                        |
| `--popover`            | `256 19% 19%`  | Popovers, dialogs (`bg-popover`)                                                                                 |
| `--primary`            | `263 69% 45%`  | Primary CTA fill (`bg-primary`)                                                                                  |
| `--secondary`          | `256 19% 25%`  | Secondary surfaces (`bg-secondary`)                                                                              |
| `--muted`              | `256 19% 25%`  | Muted / disabled surfaces (`bg-muted`)                                                                           |
| `--accent`             | `223 100% 50%` | Accent fill (`bg-accent`) — previously 61% L, raised to 50% L for 5.97:1 vs `--accent-foreground`                |
| `--destructive`        | `0 75% 45%`    | Destructive CTA fill (`bg-destructive`) — previously `0 84.2% 60.2%` which was 3.61:1 vs white, raised to 5.47:1 |
| `--sidebar-background` | `256 19% 16%`  | App sidebar (`bg-sidebar`)                                                                                       |

### Foregrounds (text and icons)

| Token                          | Value       | Notes                                                                                                                                                                                             |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--foreground`                 | `0 0% 98%`  | Primary body text. 13.80:1 vs `--background`.                                                                                                                                                     |
| `--card-foreground`            | `0 0% 98%`  | Card body text. 12.60:1 vs `--card`.                                                                                                                                                              |
| `--popover-foreground`         | `0 0% 98%`  | Popover text. 13.80:1 vs `--popover`.                                                                                                                                                             |
| `--primary-foreground`         | `0 0% 98%`  | Text on `--primary`. 7.96:1.                                                                                                                                                                      |
| `--secondary-foreground`       | `0 0% 98%`  | Text on `--secondary`. 11.33:1.                                                                                                                                                                   |
| `--muted-foreground`           | `0 0% 75%`  | Muted body text. **Raised from `0 0% 63.9%` (was 5.71:1 — passed, but borderline for `text-xs` micro-copy).** New value 7.83:1 vs `--background`. Use for text on `--background` / `--secondary`. |
| `--muted-foreground-on-card`   | `0 0% 78%`  | **New token (#1268).** Sibling of `--muted-foreground` tuned for the slightly-lighter `--card` surface (7.78:1 vs `--card`). Use this on cards; use `--muted-foreground` on the page background.  |
| `--accent-foreground`          | `0 0% 98%`  | Text on `--accent`. 5.97:1.                                                                                                                                                                       |
| `--destructive-foreground`     | `0 0% 98%`  | Text on `--destructive`. 5.47:1 (light) / 9.60:1 (dark).                                                                                                                                          |
| `--sidebar-foreground`         | `0 0% 85%`  | Sidebar body text. **Raised from `0 0% 80%`** (was 9.75:1 — passed but borderline for `text-xs`). New value 11.10:1 vs `--sidebar-background`.                                                    |
| `--sidebar-primary-foreground` | `0 0% 100%` | Text on `--sidebar-primary`. 6.70:1.                                                                                                                                                              |
| `--sidebar-accent-foreground`  | `0 0% 98%`  | Text on `--sidebar-accent`. 12.60:1.                                                                                                                                                              |

### Lines and inputs (non-text affordance — 1.4.11)

| Token              | Value          | Notes                                                                                                                                                                           |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--border`         | `256 19% 60%`  | **Raised from `256 19% 28%`** (was 1.34:1 vs `--background`). New value 4.25:1 vs bg, 3.88:1 vs card, 3.49:1 vs secondary — passes the 3:1 non-text threshold on every surface. |
| `--input`          | `256 19% 60%`  | Input border, matches `--border`.                                                                                                                                               |
| `--ring`           | `223 100% 61%` | Focus ring (`ring-ring`). 3.38:1 vs `--background`.                                                                                                                             |
| `--sidebar-border` | `256 19% 55%`  | **Raised from `256 19% 22%`** (was 1.19:1 vs sidebar-bg). New value 3.78:1 vs sidebar-bg, 3.17:1 vs sidebar-accent.                                                             |

---

## Adding a new color

1. Pick an HSL triple. Avoid pure black / pure white; prefer tints that
   sit comfortably within the existing palette so contrast pairs remain
   predictable.
2. Add the token to **both** the `:root { ... }` and `.dark { ... }`
   blocks in `src/app/globals.css`. The dark block must declare every
   token used in `:root` (the auditor enforces this).
3. Add a `<Pair>` entry to `scripts/check-color-contrast.ts` covering
   every surface you intend to use the token on. Run `npm run a11y:contrast`
   locally to confirm it passes.
4. Register the token in `tailwind.config.ts` if you want a Tailwind
   class (e.g. `bg-foo`, `text-foo`).
5. Re-run `npm run a11y:contrast:report` to refresh
   `docs/CONTRAST_AUDIT.md` and commit it with the change.

## Forbidden patterns

These patterns were silently breaking 1.4.11 and must not be reintroduced:

- `disabled:opacity-{1,2,3}\d` on any interactive element. The opacity
  drop reduces the disabled state's contrast below 3:1 against the
  adjacent surface. Provide a non-text affordance via a visible overlay,
  border, or solid background instead.
- Borders and inputs darker than ~50% lightness on the dark palette —
  they vanish into the surface.
- Muted text darker than ~75% lightness on `--background` — fails at
  small font sizes.

## References

- Issue [#1268](https://github.com/anchapin/planar-nexus/issues/1268) —
  this fix.
- WCAG 2.1 — [1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG21/#contrast-minimum),
  [1.4.11 Non-text Contrast](https://www.w3.org/TR/WCAG21/#non-text-contrast).
- Latest audit: [`CONTRAST_AUDIT.md`](./CONTRAST_AUDIT.md).
