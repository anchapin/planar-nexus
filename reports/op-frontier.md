# Card script op frontier (epic #2487, phase 4)

Generated: 2026-10-06. Aggregates `needs_new_op` reasons from `docs/card-scripts/drafts/{blb,card-list,fdn,fin,mkm,sos,tdc}.md` and groups them into capabilities ranked by the number of distinct cards each one unlocks.

## Inputs

| Set       | Cards needing new ops |
| --------- | --------------------- |
| blb       | 39                    |
| card-list | 0                     |
| fdn       | 726                   |
| fin       | 720                   |
| mkm       | 43                    |
| sos       | 468                   |
| tdc       | 22                    |

The LLM produces one bullet per _reason_. Multiple reasons collapse to the same capability below (e.g. "aura enchantment", "enchant creature", and "enchantment - aura" are all the same row).

## Top 10 ops by card-unlock count

### 1. X-cost in triggered/activated effects (69 cards)

- **CR**: CR 107.3, 601.2b (X already in spell-casting via #2552/#2553)
- **All paraphrases**: 22 (see raw-reason mapping)
- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): Goblin Negotiation (fdn), Exsanguinate (fdn), Genesis Wave (fdn), Ghalta (fdn), Primal Hunger (fdn)

**Design sketch**: Promote `X` from spell-casting into triggers/activations/statics. Schema: `amount: xAmount` (where `xAmount = z.union([amount, X])`) for `Pump`, `PutCounters`, `CreateToken`, `DealDamage` effect payloads on a trigger. Spell-level `X` is already in (#2487#2552/#2553).

### 2. return card from graveyard to battlefield (46 cards)

- **CR**: CR 400.7 (zone-change rebind)
- **All paraphrases**: 31 (see raw-reason mapping)
- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): Dewdrop Cure (blb), Sun-Blessed Healer (fdn), Alesha (fdn), Who Laughs at Fate (fdn), Reassembling Skeleton (fdn)

**Design sketch**: New `ReturnFromZone` op with `from: 'graveyard'`, `to: 'battlefield'`, `target: 'card'`, plus an optional `filter` (e.g. `creature`, `mv<=X`). Shares its identity-rebind path with `ReturnToHand`.

### 3. equipment (attach, equip cost, equipped-creature static) (44 cards)

- **CR**: CR 301.5 (equipped), 702.6 (equip keyword)
- **All paraphrases**: 23 (see raw-reason mapping)
- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): Fishing Pole (fdn), Leyline Axe (fdn), Quick-Draw Katana (fdn), Goldvein Pick (fdn), Swiftfoot Boots (fdn)

**Design sketch**: New `Equipment` schema branch in `CardScriptSchema`: `equipment: { attachTarget?: 'creature', equipCost?, static: { keywords?, power?, toughness? } }`. The engine attaches on ETB; the static applies to the equipped creature (layer 6/7c).

### 4. search library (36 cards)

- **CR**: CR 701.13 (search library)
- **All paraphrases**: 21 (see raw-reason mapping)
- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): Micromancer (fdn), Campus Guide (fdn), Hoarding Dragon (fdn), Fierce Empath (fdn), Bushwhack (fdn)

**Design sketch**: New `SearchLibrary` op: `amount: number`, `filter` (e.g. 'creature', 'land', 'cmc<=N'), `destination: 'hand' | 'battlefield' | 'graveyard'`, `shuffle: boolean` (default true). Library state is private (CR 401.5); result is the only thing the opponent sees.

### 5. flashback cost (32 cards)

- **CR**: CR 702.33 (flashback)
- **All paraphrases**: 12 (see raw-reason mapping)
- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): Revenge of the Rats (fdn), Electroduplicate (fdn), Self-Reflection (fdn), Mystical Teachings (fdn), Inspiration from Beyond (fdn)

**Design sketch**: Add `flashback: { mana }` to `CardScriptSchema`. Resolver checks the spell's source zone; if cast from graveyard, exile it instead of putting it there on resolution.

### 6. kicker / optional additional cost (28 cards)

- **CR**: CR 702.32 (kicker), 601.2b (additional costs)
- **All paraphrases**: 17 (see raw-reason mapping)
- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): Divine Resilience (fdn), Sun-Blessed Healer (fdn), Burst Lightning (fdn), Gnarlid Colony (fdn), Grow from the Ashes (fdn)

**Design sketch**: Add `kicker: {mana, count?}` to `CardScriptSchema` (or a `costs.kicker` block). Effects after the spell can branch on `if_kicked: true|false`; the cast-time UI flips the cost when the player opts in.

### 7. add mana (27 cards)

- **CR**: CR 106 (mana), 605 (mana abilities)
- **All paraphrases**: 19 (see raw-reason mapping)
- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): Llanowar Elves (fdn), Druid of the Cowl (fdn), Cultivator's Caravan (fdn), Three Tree Mascot (fdn), Ruby (fdn)

**Design sketch**: New `AddMana` op: `amount`, `colors: ('W'|'U'|'B'|'R'|'G'|'C')[] | 'any'`, optional `restrict` (e.g. 'spend only on creatures'). The mana ability flag is automatic (CR 605.1).

### 8. shuffle library (26 cards)

- **CR**: CR 701.20 (shuffling)
- **All paraphrases**: 9 (see raw-reason mapping)
- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): Bushwhack (fdn), Burnished Hart (fdn), Campus Guide (fdn), Solemn Simulacrum (fdn), Wishclaw Talisman (fdn)

**Design sketch**: New `ShuffleLibrary` op (`who: 'you' | 'target_player'`). Reusable whenever a search or put-back happens.

### 9. indestructible keyword (17 cards)

- **CR**: CR 702.13 (indestructible), 701.9 (lose abilities removes it)
- **All paraphrases**: 12 (see raw-reason mapping)
- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): Crumb and Get It (blb), Dawn's Truce (blb), Celestial Armor (fdn), Divine Resilience (fdn), Predator Ooze (fdn)

**Design sketch**: Add `indestructible: true` to `StaticSchema.keywords` (alongside the existing evergreen keywords). Grant-from-effect: a new op `GrantKeyword { keyword, target, until }`. Aura pump block gets the same field.

### 10. aura enchantment (15 cards)

- **CR**: CR 702.5 (Enchant), 303.4 (auras)
- **All paraphrases**: 8 (see raw-reason mapping)
- **Sample of unlocked cards** (first 5 best-effort, see mapping for the full list): Feather of Flight (blb), Twinblade Blessing (fdn), Witness Protection (fdn), Blanchwood Armor (fdn), Pacifism (fdn)

**Design sketch**: New `Enchant` op with `target` ('creature' | 'land' | 'planeswalker' | 'permanent'), plus a static pumping the enchanted permanent (CR 604, layer 7c). Replaces the inline 'enchanted creature gets +2/+2' ad-hoc phrasing.

## Capability → raw-reason mapping (for traceability)

- **X-cost in triggered/activated effects** (69 cards)
  - x costs [fdn]
  - x costs in effects [fdn]
  - x costs in activation costs [fdn]
  - draw a card for each different mana value among nonland permanents you control (dynamic x based on board state) [fdn]
  - effect 'put that many +1/+1 counters on it' requires dynamic x based on damage dealt [fdn]
  - x cost based on life gained this turn [fdn]
  - x costs in etb effects [fdn]
  - x costs in pump effect [fdn]
  - x costs in token creation [fdn]
  - x costs in triggered abilities [fdn]
  - x power dependency in effect [fdn]
  - x costs [fin]
  - x costs (conditional cost reduction) [fin]
  - x costs in activation cost [fin]
  - x costs in effects [fin]
  - x costs [sos]
  - dynamic x value based on life gained [sos]
  - x cost in activated ability [sos]
  - x cost in activation [sos]
  - x costs (mana spent to cast) [sos]
  - x costs based on mana spent [sos]
  - x costs in effects [sos]
- **return card from graveyard to battlefield** (46 cards)
  - returning cards from graveyard to battlefield [blb]
  - return card from graveyard to battlefield [fdn]
  - return card from graveyard to hand [fdn]
  - effect 'return target card from graveyard to the battlefield' is not supported [fdn]
  - return cards from graveyard to battlefield [fdn]
  - return cards from graveyard to hand [fdn]
  - return creature card from graveyard to battlefield [fdn]
  - return from graveyard to battlefield [fdn]
  - return target card from graveyard to battlefield [fdn]
  - return target card from graveyard to hand [fdn]
  - return target creature card from graveyard to battlefield [fdn]
  - return target creature cards from graveyard to hand [fdn]
  - return to battlefield effect [fdn]
  - return to battlefield from graveyard [fdn]
  - return card from graveyard to battlefield [fin]
  - return target cards from graveyard to hand [fin]
  - return card from graveyard or exile to hand [fin]
  - return from graveyard to hand [fin]
  - return target card from graveyard to battlefield [fin]
  - return target creature card from graveyard to battlefield [fin]
  - return creature card from graveyard to battlefield [mkm]
  - return card from graveyard to battlefield [sos]
  - return card from graveyard to hand [sos]
  - return cards from graveyard to hand [sos]
  - return from graveyard to battlefield [sos]
  - put a card from a graveyard onto the battlefield [sos]
  - return cards from graveyard to battlefield [sos]
  - return target card from graveyard to battlefield [sos]
  - return target card from graveyard to hand [sos]
  - return target cards from graveyard to hand [sos]
  - return card from graveyard to battlefield [tdc]
- **equipment (attach, equip cost, equipped-creature static)** (44 cards)
  - equipment mechanics [fdn]
  - equipment mechanics (attach to creature) [fdn]
  - equipment mechanics (attach, equip cost, static buff to equipped creature) [fdn]
  - equipment mechanics (attach, equip) [fdn]
  - equipment mechanics (attach, equipped creature) [fdn]
  - equip cost [fin]
  - attach effect [fin]
  - equipment mechanics [fin]
  - equip ability [fin]
  - equipment mechanics (attach, equip cost) [fin]
  - equipment mechanics (attach, equip) [fin]
  - equipped creature gains subtype [fin]
  - attach an equipment to a creature [fin]
  - attach an equipment you control [fin]
  - attach equipment [fin]
  - attach equipment effect [fin]
  - equip cost with name [fin]
  - equipment attachment [fin]
  - equipment mechanics (attach, equip cost, static effects granting abilities/subtypes to equipped creature) [fin]
  - equipped creature gains ability [fin]
  - equipped creature gains triggered ability [fin]
  - equipped creature gets +1/+1 [fin]
  - equipment mechanics (equip, equipped creature) [mkm]
- **search library** (36 cards)
  - search library [fdn]
  - search library for a card [fdn]
  - search library for cards [fdn]
  - search library for a card and put it into graveyard [fdn]
  - search library for a card and put it into hand [fdn]
  - search library for a card and put it onto the battlefield [fdn]
  - search library for a card with specific properties [fdn]
  - search library for card [fdn]
  - search library for cards and put onto battlefield [fdn]
  - search your library for land cards [fdn]
  - search library [fin]
  - search library for a card [fin]
  - search library for a card and put it onto the battlefield [fin]
  - search library for card [fin]
  - search library for card and put onto battlefield [fin]
  - search library for cards [fin]
  - search library [sos]
  - search library for card [sos]
  - search library for a card [sos]
  - search library for a card and put it onto the battlefield [sos]
  - search your library for land cards [tdc]
- **flashback cost** (32 cards)
  - flashback cost [fdn]
  - flashback [fdn]
  - flashback cost and mechanic [fdn]
  - flashback is not a supported effect or keyword [fdn]
  - flashback [fin]
  - flashback cost [fin]
  - flashback mechanic [fin]
  - flashback cost [sos]
  - flashback [sos]
  - flashback cost involving tapping multiple permanents [sos]
  - flashback mechanic [sos]
  - flashback is a keyword ability that allows casting from the graveyard and exiling upon resolution, which is not supported by the current ops or spell structure [tdc]
- **kicker / optional additional cost** (28 cards)
  - kicker cost [fdn]
  - additional cost to cast this spell [fdn]
  - additional cost to cast [fdn]
  - additional costs [fdn]
  - optional cost payment (you may pay {r}) [fdn]
  - additional costs [fin]
  - additional costs (pay life) [fin]
  - additional costs (sacrifice/pay) [fin]
  - kicker cost [fin]
  - kicker cost (sacrifice) [fin]
  - optional cost 'you may sacrifice another creature or artifact' [fin]
  - optional costs (may pay life) [fin]
  - optional costs (you may pay {1}) [fin]
  - additional cost to cast [sos]
  - additional costs (pay life) [sos]
  - additional costs (discard/pay life) [tdc]
  - kicker cost [tdc]
- **add mana** (27 cards)
  - add mana [fdn]
  - add one mana of any color [fdn]
  - ability to add mana [fdn]
  - add {c} [fdn]
  - add mana effect [fdn]
  - add mana of any one color [fdn]
  - add mana to mana pool [fdn]
  - adding mana to mana pool [fdn]
  - mana production [fdn]
  - add mana [fin]
  - add {c} with restriction [fin]
  - add mana effect [fin]
  - add one mana of any color [fin]
  - add mana [sos]
  - mana production effect [sos]
  - add mana effect [sos]
  - add one mana of any color [sos]
  - mana production [sos]
  - mana production effects [sos]
- **shuffle library** (26 cards)
  - shuffle library [fdn]
  - shuffle [fdn]
  - shuffle graveyard into library [fdn]
  - shuffle library [fin]
  - shuffle [fin]
  - shuffle cards from graveyard into library [fin]
  - shuffle library [sos]
  - shuffle [sos]
  - shuffle [tdc]
- **indestructible keyword** (17 cards)
  - granting indestructible [blb]
  - indestructible keyword [blb]
  - indestructible keyword [fdn]
  - indestructible keyword is not supported in the pump op or as a static effect [fdn]
  - gain indestructible until end of turn [fdn]
  - indestructible effect [fdn]
  - indestructible keyword/effect [fdn]
  - those creatures gain indestructible until end of turn [fdn]
  - creatures you control gain indestructible (static effect other than p/t or evergreen keywords) [fin]
  - indestructible [fin]
  - indestructible keyword [fin]
  - indestructible [sos]
- **aura enchantment** (15 cards)
  - aura enchantment [blb]
  - aura enchantment [fdn]
  - enchant creature [fdn]
  - enchant creature, land, or planeswalker [fdn]
  - enchant land [fdn]
  - enchantment - aura [fdn]
  - enchant creature (aura attachment) [fin]
  - enchant creature (aura targeting) [mkm]
- **hexproof keyword (self, from-color, or conditional)** (14 cards)
  - hexproof keyword [blb]
  - hexproof [fdn]
  - hexproof keyword [fdn]
  - hexproof for player [fdn]
  - hexproof from specific card types [fdn]
  - hexproof from white [fdn]
  - hexproof [fin]
  - gain hexproof until end of turn [mkm]
  - hexproof [sos]
- **ward keyword / ward cost** (12 cards)
  - ward cost (pay life) [fdn]
  - ward keyword [fdn]
  - ward—pay 7 life [fdn]
  - ward cost involving variable power [fin]
  - ward cost [sos]
  - ward {2} is not a supported keyword [sos]
  - ward cost (pay life) [sos]
  - ward—pay 5 life [sos]
- **exile card from graveyard** (8 cards)
  - exile card from graveyard with condition 'put there this turn' [fdn]
  - exile target player's graveyard [fdn]
  - exile up to one target card from a graveyard [fdn]
  - targeting cards in graveyards [fdn]
  - exile from graveyard [mkm]
  - exile card from graveyard [sos]
  - exile cards from graveyard [sos]
  - targeting cards in graveyards [sos]
- **exile until this enchantment leaves the battlefield** (6 cards)
  - exile until this creature leaves the battlefield [blb]
  - exile until this enchantment leaves the battlefield [blb]
  - exile until this enchantment leaves the battlefield [fdn]
  - exile until this enchantment leaves the battlefield [mkm]

## Deferred (set-specific, not Standard post-rotation)

- BLB `gift` (4 cards) and `valiant` (3 cards) — Bloomburrow block rotates out of Standard 2027-Q4; draft now if FDN-replacement sets need them.
- MKM `disguise` (4 cards) — Murders at Karlov Manor rotates 2027-Q4.
- MKM `suspect` (2 cards) — Murders-specific; no Standard card cares about it after rotation.

Re-run with `npx tsx scripts/build-op-frontier.ts` after any new draft report lands.
