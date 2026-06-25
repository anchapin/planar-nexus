# Standard Rotation Tracking

This document describes how Planar Nexus tracks Standard format set rotation
and how to update the rotation schedule when new sets release.

## Overview

The **Constructed Core** game mode (the in-app "Standard" format) rotates sets
out of legality on a schedule. Without rotation tracking, a deck validator can
only check banned/restricted lists — it cannot tell when a card's set has aged
out of Standard. Issue [#996](https://github.com/anchapin/planar-nexus/issues/996)
added rotation awareness so the deck builder can flag rotated cards.

## Where it lives

- **Schedule + logic:** `src/lib/game-rules.ts`
  - `STANDARD_ROTATION_SCHEDULE` — the canonical list of sets, their release
    dates, and the dates they rotate out of Standard.
  - `getStandardLegalSets(referenceDate?)` — returns the set codes legal in
    Standard as of a given date (defaults to now).
  - `validateStandardRotation(cards, referenceDate?)` — checks a card list and
    returns rotated cards, unknown-set cards, and human-readable warnings.
- **Card field:** `MinimalCard.release_date` in `src/lib/card-database.ts`
  (optional ISO-8601 date). Populated from Scryfall's `released_at` when cards
  are ingested.
- **UI:** The Deck Builder page (`src/app/(app)/deck-builder/page.tsx`) shows a
  yellow warning `Alert` when a Standard deck contains rotated cards.

## How legality is computed

A set is **legal** in Standard from its `releaseDate` (inclusive) up to but not
including its `rotationDate`, evaluated against the reference date (today by
default):

```
releaseDate <= referenceDate < rotationDate
```

Cards whose set code is **not present** in the schedule at all are reported as
"unknown set" (so reviewers can decide whether to add the set), separate from
cards whose set is present but has rotated out.

## Rotation produces warnings, not hard errors

Rotation violations are surfaced as **warnings** (in `ValidationResult.warnings`),
not errors. This keeps existing decks editable and importable while still
flagging the issue to the user. `isDeckLegal()` returns `false` when any
warning is present, so lobby/ready checks still treat a rotated deck as not
match-ready.

## Updating the schedule when a new set releases

1. Open `src/lib/game-rules.ts` and locate `STANDARD_ROTATION_SCHEDULE`.
2. Append a new entry:

   ```ts
   { set: "new", releaseDate: "2025-09-26", rotationDate: "2027-10-30" },
   ```

   - `set` — the Scryfall set code, lowercase.
   - `releaseDate` — the set's prerelease/release date (ISO-8601).
   - `rotationDate` — the date the set leaves Standard. This is typically the
     release date of the first set of the following Standard year (roughly two
     years after release for the modern rotation cadence).

3. If an older set's rotation date has now been confirmed/determined, update
   its `rotationDate` so it rotates out at the correct time.
4. Add or update unit tests in `src/lib/__tests__/game-rules.test.ts` — in
   particular the `referenceDate` used by the "Standard Rotation Awareness"
   suite may need bumping forward if the test date has crossed a rotation
   boundary.
5. Run `npm run typecheck && npm test -- src/lib/__tests__/game-rules.test.ts`
   to verify.

## Verifying rotation data

The canonical source of truth for set codes and release dates is the
[Scryfall Sets API](https://scryfall.com/docs/api/sets). Always cross-check
`set` codes and `releaseDate` values against Scryfall before committing a
schedule update.
