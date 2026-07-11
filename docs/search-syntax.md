# Search Syntax (Deck Builder)

> Issue #1440 — Orama structured-query surface for the deck-builder card search.

## Overview

The Deck Builder card search supports two modes:

1. **Fuzzy mode (default)** — A typo-tolerant name search backed by Orama's
   full-text tokenizer. Behaviour is unchanged from prior releases.
2. **Power mode (opt-in)** — A Scryfall-style syntax that surfaces the
   underlying Orama `where:` clause directly. Toggle via the **Power
   search** switch next to the search input.

Power mode targets users who already know what they want (paper Magic
players coming from Scryfall / EDHREC / Moxfield). The fuzzy mode remains
the default so existing users see no change.

## Enabling Power mode

Click the **Power search** switch in the deck-builder search panel. A
`?` icon next to the switch opens a popover with the supported keys.

## Supported keys

| Syntax                    | Semantics                                                                |
| ------------------------- | ------------------------------------------------------------------------ |
| `c:red`                   | Color include (single pip, case-insensitive)                             |
| `c:wubrg`                 | Color include (multi-letter shorthand; OR across the listed pips)        |
| `c:w,u,b,r,g`             | Same as above using the spelled-out form                                 |
| `t:instant`               | Type include (substring on `type_line`)                                  |
| `t:instant,sorcery`       | Type OR — match either                                                   |
| `cmc<=3` / `cmc<3`        | Mana value less-than-or-equal / less-than                                |
| `cmc>=4` / `cmc>4`        | Mana value greater-than-or-equal / greater-than                          |
| `cmc=2`                   | Mana value equals                                                        |
| `cmc!=0`                  | Mana value not-equals                                                    |
| `mv:N`                    | Alias for `cmc=N`                                                        |
| `r:rare`                  | Rarity (parsed but not yet indexed — surfaces a warning)                 |
| `s:mh2`                   | Set code substring match                                                 |
| `"foo bar"`               | Quoted free-text preserved verbatim                                      |
| any other word            | Free-text term matched against name, type line, and oracle text          |

## Examples

| Query                              | Matches                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `c:red t:instant cmc<=3`           | All red instants with mana value ≤ 3                          |
| `c:wubrg t:creature`               | Any-color creatures                                           |
| `cmc>=4`                           | Cards with mana value ≥ 4                                     |
| `s:mh2 bolt`                       | "bolt" cards in Modern Horizons 2                              |
| `c:red t:creature cmc=2`           | Two-mana red creatures                                        |

## Architecture

### Modules

- `src/lib/search/query-parser.ts` — tokenizer + AST + `where:` compiler.
  Pure functions, no React. Exposes `parseCardQuery(input)` returning a
  `ParsedQuery` (the `term` to forward to fuzzy search + the compiled
  `where:` object + any parse errors). Implementation: ~280 LoC including
  comments.
- `src/hooks/use-structured-search.ts` — thin React hook wrapping
  `useSearchWorker` plus the parser. Returns `{ results, parsed, errors,
  isSearching, run }` so the UI can react to parse failures inline.
- `src/app/(app)/deck-builder/_components/card-search.tsx` — UI addition:
  the Power switch, the syntax help popover, and a branch in the search
  effect that routes through the structured path when the toggle is on.

### `where:` clause shape (Orama 3.x)

The parser emits Orama's native `where:` shapes:

```ts
// c:red t:instant cmc<=3
{
  colors: "R",
  type_line: { contains: "instant" },
  cmc: { lte: 3 },
}

// c:wubrg t:instant,sorcery cmc>=4
{
  colors: { contains: ["W", "U", "B", "R", "G"] },
  or: [
    { type_line: { contains: "instant" } },
    { type_line: { contains: "sorcery" } },
  ],
  cmc: { gte: 4 },
}
```

`number` fields use Orama's documented comparison operators
(`eq / neq / gt / gte / lt / lte`). `string` fields use either direct
equality, `contains` for substring matches, or the `or:` envelope for
multi-value OR semantics.

### Limits

- Input capped at 200 characters; longer queries are truncated and a
  warning is surfaced as a parse error.
- Unbalanced quotes bail out before tokenisation (preventing downstream
  miscounts).

### Failure modes

The parser surfaces `QueryParseError` records with `{ position, query,
message, token? }` instead of throwing. The UI renders the first error
as an inline chip; the search still runs so users keep seeing results.

| Failure             | Surfaced message                | Behaviour                                  |
| ------------------- | ------------------------------- | ------------------------------------------ |
| Unbalanced quote    | "Unbalanced quote in query."    | Bail out; old results preserved            |
| Unknown color spec  | "Unknown color spec `xxx` …"    | Drop the color filter; rest still searches |
| Non-numeric CMC     | "Expected a number, got …"      | Drop the CMC clause; rest still searches   |
| Input over 200 char | "Query truncated to 200 chars…" | Truncate; rest still searches              |

## Testing

| File                                                            | Covers                                 |
| --------------------------------------------------------------- | -------------------------------------- |
| `src/lib/search/__tests__/query-parser.test.ts`                 | Parser (33 unit assertions)            |
| `src/hooks/__tests__/use-structured-search.test.ts`             | Hook call shape, parse-error surface   |
| `src/app/(app)/deck-builder/_components/__tests__/card-search.power-search.test.tsx` | UI: toggle, popover, fallback wiring |

Run locally:

```bash
npm test -- src/lib/search/__tests__/query-parser.test.ts
npm test -- src/hooks/__tests__/use-structured-search.test.ts
npm test -- 'src/app/(app)/deck-builder/_components/__tests__/card-search.power-search.test.tsx'
```

## Why an opt-in toggle?

The fuzzy mode covers >95% of common cases for users who haven't seen
Scryfall syntax before. Forcing the structured syntax would require a
learning curve and risks mistyping-rage for users who never asked for
the surface area. The opt-in toggle keeps the existing UX intact while
giving power users a familiar expression language.
