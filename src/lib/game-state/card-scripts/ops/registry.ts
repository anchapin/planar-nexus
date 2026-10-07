/**
 * Per-op registry (epic #2487, phase 2.3).
 *
 * Imports every op's documentation module under `ops/<OpName>.ts` and
 * assembles the `OP_REFERENCE` map consumed by
 * `scripts/card-scripts/draft-lib.ts`. Each op module is a single-line
 * description (the same string the LLM reads when it scripts a card that
 * uses the op); the schema arm still lives in `schema.ts` and the
 * interpreter dispatch in `interpret.ts`. Moving those into per-op
 * modules is a separate, larger refactor (#2487 phase 2.3 future work).
 *
 * A new op lands with one PR touching two files:
 *   1. `ops/<OpName>.ts` (new, exports `CardOpReference`).
 *   2. This file (import + entry).
 *
 * The "documents every schema op" test in scripts/card-scripts/
 * `__tests__/draft-lib.test.ts` reads `OP_REFERENCE` from
 * `buildOpReference()` and confirms it covers every arm of
 * `EffectSchema.options` (#2551). Drift is impossible: if an op schema
 * exists here, its reference must exist too.
 */
import { AttachEquipmentReference } from "./attach-equipment";
import { BiteReference } from "./bite";
import { CopySpellReference } from "./copy-spell";
import { CounterReference } from "./counter";
import { CreatePredefinedTokenReference } from "./create-predefined-token";
import { CreateTokenReference } from "./create-token";
import { DealDamageReference } from "./deal-damage";
import { DestroyReference } from "./destroy";
import { DiscardReference } from "./discard";
import { DrawReference } from "./draw";
import { ExileReference } from "./exile";
import { FightReference } from "./fight";
import { GainLifeReference } from "./gain-life";
import { LoseLifeReference } from "./lose-life";
import { MillReference } from "./mill";
import { PumpReference } from "./pump";
import { PutCountersReference } from "./put-counters";
import { ReturnToHandReference } from "./return-to-hand";
import { ScryReference } from "./scry";
import { SearchLibraryReference } from "./search-library";
import { SurveilReference } from "./surveil";
import { TapReference } from "./tap";
import { UntapReference } from "./untap";

import type { CardOpReference } from "./types";

export const OP_REFERENCES: readonly CardOpReference[] = [
  DealDamageReference,
  DrawReference,
  GainLifeReference,
  LoseLifeReference,
  CreateTokenReference,
  CreatePredefinedTokenReference,
  DestroyReference,
  ExileReference,
  TapReference,
  UntapReference,
  ReturnToHandReference,
  CounterReference,
  AttachEquipmentReference,
  PumpReference,
  PutCountersReference,
  SurveilReference,
  ScryReference,
  MillReference,
  DiscardReference,
  CopySpellReference,
  SearchLibraryReference,
  FightReference,
  BiteReference,
];

/**
 * Build a fresh `OP_REFERENCE` map for the LLM. Keys are op names; values
 * are the one-line description each module exports. The companion test
 * `scripts/card-scripts/__tests__/draft-lib.test.ts` checks this map covers
 * `EffectSchema.options` exactly (#2551).
 */
export function buildOpReference(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ref of OP_REFERENCES) out[ref.name] = ref.reference;
  return out;
}
