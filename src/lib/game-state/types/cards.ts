/**
 * Card identity types: the card instance shape, counters, and untap modifiers.
 *
 * Mechanically extracted from types.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { ScryfallCard } from "./card-data";
import { PlayerId } from "./players";

/**
 * Unique identifier for a card instance in the game
 */
export type CardInstanceId = string;

/**
 * Represents a single physical card in play
 * Unlike ScryfallCard which defines card types, this tracks game state
 */
export interface CardInstance {
  id: CardInstanceId;
  /** The oracle definition of this card */
  oracleId: string;
  /** Card face data - imported from Scryfall */
  cardData: ScryfallCard;
  /** Current face for double-faced/transform cards */
  currentFaceIndex: number;
  /**
   * Front-face card data, kept while a transforming DFC shows its back face
   * (CR 712). Restored when it transforms back or leaves the battlefield.
   */
  transformOriginalCardData?: ScryfallCard;
  /**
   * Set when a Vehicle's crew ability resolves (CR 702.122): it is an
   * artifact creature until end of turn. Cleared when the next turn begins.
   */
  crewedUntilEndOfTurn?: boolean;
  /**
   * Set while a "During your turn, as long as ~ has one or more loyalty
   * counters on him, he's a 3/4 Ninja creature and has hexproof" static is
   * active (Kaito, Bane of Nightmares; issue #2300). Maintained by
   * `refreshTurnCreatureForms`.
   */
  turnCreatureForm?: {
    power: number;
    toughness: number;
    subtype: string;
    hexproof: boolean;
  };
  /** Whether this card is face down (for morph, manifest, etc.) */
  isFaceDown: boolean;
  /** Current controller of this card */
  controllerId: PlayerId;
  /** Original owner of this card */
  ownerId: PlayerId;

  // State flags
  /** Whether the permanent is activated (internally tracked as "tapped" for compatibility) */
  isTapped: boolean;
  /**
   * Untap-modifying effect hook (CR 502.2).
   * When true, this permanent does NOT untap during its controller's untap step
   * (e.g. "This creature doesn't untap during your untap step").
   * Evaluated by the discrete untap step processor (`processUntapStep`).
   */
  doesNotUntapDuringUntapStep?: boolean;
  /** Whether the permanent is flipped (flip cards) */
  isFlipped: boolean;
  /** Whether the permanent is turned face up (was face down) */
  isTurnedFaceUp: boolean;
  /** Whether the permanent is phased out */
  isPhasedOut: boolean;
  /** Whether the permanent has deployment restriction (internally tracked as "summoning sickness") */
  hasSummoningSickness: boolean;

  // Counters and modifications
  /** Markers on this card (p1p1, +1/+1, charge, etc.) */
  counters: Counter[];
  /** Damage marked on this creature (0 for non-creatures) */
  damage: number;
  /** Toughness modifications from effects */
  toughnessModifier: number;
  /** Power modifications from effects */
  powerModifier: number;

  // Attachments and relationships
  /** ID of card this is attached to (for Equipment, Auras, Fortifications) */
  attachedToId: CardInstanceId | null;
  /** IDs of cards attached to this (for creatures with Equipment/Auras) */
  attachedCardIds: CardInstanceId[];
  /** IDs of cards merged with this one via mutate (CR 702.140) */
  mutatedCardIds: CardInstanceId[];
  /** ID of the base creature this card is mutated onto (null if base or not mutated) */
  mutateBaseId: CardInstanceId | null;
  /** Whether this creature is part of a mutate stack */
  isMutated: boolean;
  /** ID of the component with the highest CMC (for text display) */
  highestCmcComponentId: CardInstanceId | null;

  // Timestamps for ordering
  /** When this permanent entered the play area (for timestamp ordering) */
  enteredBattlefieldTimestamp: number;
  /** When this card became attached to its current attachment */
  attachedTimestamp: number | null;

  // Land-specific
  /** For lands like Multiversal Passage - the chosen basic land type this land is */
  chosenBasicLandType: string | null;

  // Enter-time choice (#2594 follow-up, Wave 4.7 lane 39)
  /**
   * The color chosen for a permanent with a `script.enter_choice` of
   * `kind: "color"` (e.g. Heraldic Banner's "as this enters, choose
   * a color"). Set by `resolveEnterChoice` when the controller answers
   * the `enter_choice` waiting choice, then read by downstream
   * statics / AddMana that use the `chosen` sentinel (lanes 40 + 41).
   * `null` until the choice resolves, or on permanents that don't
   * carry an `enter_choice: { kind: "color" }` script.
   */
  chosenColor: "W" | "U" | "B" | "R" | "G" | null;
  /**
   * Wave 4.7 follow-up lane 44 (#2705a): the chosen creature
   * type for a permanent with `enter_choice: { kind: "creature_type" }`
   * (Banner of Kinship / Adaptive Automaton, CR 604). Stamped by
   * `resolveEnterChoice` in
   * `keyword-actions/enter-choice.ts`. The chosen-type anthem
   * (lane 45) reads this through the `affects.subtype: "chosen"`
   * sentinel and substitutes the type when refreshing statics.
   * `null` until the choice resolves, or on permanents that
   * don't carry an `enter_choice: { kind: "creature_type" }`
   * script.
   */
  chosenCreatureType: string | null;
  /**
   * Wave 4.8 lane 52 (#2614 follow-up): the per-instance
   * subtype additions granted by a
   * `StaticSchema.affects.add_creature_type` static on the
   * source itself (Adaptive Automaton's "is the chosen type in
   * addition to its other types" half). Set by
   * `refreshScriptedStatics` at refresh time: for every static
   * with `add_creature_type` and `addCreatureTypeToSelf: true`,
   * the source's `chosenTypeAdditions` grows by the resolved
   * type string (literal string verbatim, or
   * `source.chosenCreatureType` for the `"chosen"` sentinel).
   * The local `subtypesOf` helper in
   * `keyword-actions/scripted-statics.ts` unions these into
   * the read so other statics (the chosen-type anthem in lane
   * 45) can see the addition at the next refresh pass.
   *
   * The chosen-eviction-at-tombstone problem (the source
   * leaves the battlefield while the addition is still
   * active — should the temporary addition drop or persist
   * into the graveyard? Answer: drop, since `subtypes` is
   * irrelevant in non-battlefield zones) is naturally handled
   * by `chosenTypeAdditions` being a battlefield-zone-only
   * field — the engine writes it on a battlefield card and
   * reads it via the local helper which only fires for cards
   * currently on the battlefield. The field is left unset on
   * permanents without an `add_creature_type` static; default
   * empty array `[]` is acceptable.
   */
  chosenTypeAdditions?: string[];
  /**
   * Wave 4.7 follow-up lane 48 schema baseline (#2708 phase 1):
   * the chosen card name for a permanent with
   * `enter_choice: { kind: "chosen_name" }` (Sorcerous Spyglass,
   * CR 604). Stamped by the multi-lane engine arm tracked in
   * #2708 — that arm is not yet implemented; v1 ships the
   * schema + the default-null field so a follow-up lane can
   * extend the engine without a schema bump. `null` on every
   * permanent today; the field is forward-compatible.
   */
  chosenCardName: string | null;

  // Token-specific
  /** Whether this is a token */
  isToken: boolean;
  /** For tokens, a copy of the token's defining characteristics */
  tokenData: ScryfallCard | null;

  // Blitz-specific (CR 702.150)
  /**
   * Whether this permanent was cast for its blitz cost this turn.
   *
   * Set on a creature as it enters the battlefield via a blitz-cost cast. While
   * true the creature gains haste, a "when this creature dies, draw a card"
   * triggered ability, and is sacrificed at the beginning of the next end step
   * (CR 702.150a). Only set when the blitz alternate cost was actually paid;
   * normal casting never sets this (CR 702.150b — blitz effects apply only to
   * the blitz-cost cast). Consumed/cleared when the creature leaves the
   * battlefield.
   */
  blitz?: boolean;

  // Foretell-specific (CR 702.142)
  /**
   * Whether this card is currently foretold: exiled face down by its owner via
   * the Foretell keyword action (CR 702.142b). While true the card lives in its
   * owner's exile zone, face down (`isFaceDown === true`), hidden from other
   * players but visible to its owner, and may be cast for its foretell cost on a
   * later turn (CR 702.142c). Cleared when the card is cast or leaves exile.
   */
  foretold?: boolean;
  /**
   * The turn number on which this card was foretold (CR 702.142b). Used to
   * enforce that a foretold card cannot be cast for its foretell cost on the
   * same turn it was foretold — only on a later turn (CR 702.142c).
   */
  foretoldTurn?: number;

  // Warp-specific (CR 702.185)
  /**
   * Whether this permanent was cast for its warp cost (CR 702.185a). While
   * true it is exiled at the beginning of the next end step. Set at
   * resolution only when the warp cost was paid.
   */
  warp?: boolean;
  /**
   * The turn number on which warp exiled this card. While it stays in exile
   * its owner may cast it from there on a later turn (CR 702.185a).
   */
  warpExiledTurn?: number;

  // Flashback-specific (CR 702.143)
  /**
   * Whether this card is currently being cast for its flashback cost (CR
   * 702.143a). Set when the flashback alternative cost is paid; the engine
   * uses the `alternativeCostsUsed` array on the StackObject for the actual
   * zone redirect on resolution, so this field is purely informational /
   * for introspection (mirrors `foretold`). Cleared when the card leaves the
   * stack.
   */
  flashback?: boolean;

  // Kicker-specific (CR 702.32, #2564)
  /**
   * Whether this card was kicked on the most recent cast. Set when the
   * player opts into the kicker additional cost (`castSpell(..., true)`)
   * and stays true through resolution. For a permanent with an ETB
   * "if kicked" trigger, the engine reads this field to decide whether the
   * bonus effect fires. The engine's authoritative signal is
   * `StackObject.wasKicked` / `timesKicked`; this field is the
   * CardInstance-level mirror so the kicker state survives after the spell
   * has resolved (mirrors `flashback`).
   */
  kicked?: boolean;
  /**
   * Number of times the kicker (or multikicker, CR 702.85 #2594) cost was
   * paid on the most recent cast. 0 for non-kicker casts; 1 for
   * single-kicker; N for multikicker. The ETB "if kicked" trigger path
   * (`trigger-system/stack-ops.ts`) reads this to stamp the trigger's
   * `StackObject.timesKicked` so the interpreter's `if_kicked: N` gate
   * fires the right tiered effect.
   */
  timesKicked?: number;

  // Prototype-specific (CR 702.152)
  /** Whether this permanent is currently in prototype form */
  isPrototype: boolean;
  /** Prototype alternative power (when in prototype form) */
  prototypePower: number | null;
  /** Prototype alternative toughness (when in prototype form) */
  prototypeToughness: number | null;
  /** Prototype alternative mana cost string (when in prototype form) */
  prototypeManaCost: string | null;

  // Boast keyword (CR 702.131) - tracks if this creature attacked last turn
  /** Whether this creature attacked during the previous turn */
  attackedLastTurn: boolean;

  // Prowess keyword (CR 702.108) - +1/+1 bonus active this turn
  /**
   * Number of prowess +1/+1 bonuses currently active on this creature (CR
   * 702.108). Each time the creature's controller casts a noncreature spell,
   * a prowess trigger adds +1 to this counter (one per prowess instance, CR
   * 702.108b); the layer-7 power/toughness read path adds `prowessBoost` to
   * both power and toughness as a continuous "until end of turn" effect. It is
   * cleared during the end-of-turn cleanup (see `clearProwessBoosts`).
   */
  prowessBoost?: number;

  /**
   * Total of "gets +X/+Y until end of turn" effects on this permanent from
   * resolved spells and abilities (CR 611.2a, layer 7c), e.g. Tragic
   * Banshee's -1/-1. Cleared at end of turn (see `clearUntilEndOfTurnPT`).
   */
  untilEndOfTurnPT?: { power: number; toughness: number };
  /**
   * Keywords granted to this permanent "until end of turn" by a resolved
   * spell or ability (e.g. Divine Resilience's lifelink, #2564). The
   * layer-6 keyword read path unions these onto the card's keyword set for
   * the rest of the turn; cleared at end of turn (see
   * `clearUntilEndOfTurnKeywords`).
   */
  untilEndOfTurnKeywords?: string[];

  /**
   * Subtypes this permanent has "until end of turn" in addition to its
   * printed ones (#2614 Sarkhan, Dragon Ascendant: "becomes a Dragon in
   * addition to his other types"). `hasSubtype` reads them; cleared at end
   * of turn with the other until-end-of-turn effects.
   */
  untilEndOfTurnSubtypes?: string[];

  /**
   * Active threshold static bonus (power/toughness, granted keywords,
   * unblockable) while its controller has seven or more cards in their
   * graveyard. Maintained by `refreshThresholdBonuses`.
   */
  thresholdBonus?: {
    power: number;
    toughness: number;
    keywords: string[];
    unblockable: boolean;
  };

  /**
   * Power/toughness change this creature gets from another player's active
   * threshold static ability, e.g. Mindwhisker's "creatures your opponents
   * control get -1/-0". Maintained by `refreshThresholdBonuses`.
   */
  thresholdAnthemPT?: { power: number; toughness: number };
  /** Domain CDA power (issue #2300), refreshed with state-based actions. */
  domainPower?: number;
  /**
   * Indexes of this permanent's "activate only once" abilities that have
   * been activated (CR 602.5b, issue #2482). A permanent that changes zones
   * is a new object (CR 400.7), so this is cleared on every zone move.
   */
  activatedOnceAbilities?: number[];
  /**
   * "Activate only once each turn" abilities used this turn (CR 602.5b,
   * issue #2496): indexes tagged with the turn they were activated, so a
   * new turn needs no reset. Cleared on zone moves (CR 400.7).
   */
  activatedThisTurn?: { turn: number; abilities: number[] };
  /**
   * Summed bonus from "Other <Type>s you control get +N/+N" lords (issue
   * #2300). Maintained by `refreshTribalAnthems`.
   */
  tribalAnthemPT?: { power: number; toughness: number };
  /**
   * Summed static bonus from Auras attached to this creature, e.g. Ethereal
   * Armor (issue #2453). Maintained by `refreshAuraBonuses`.
   */
  auraPT?: { power: number; toughness: number };
  /**
   * Keywords granted by Auras attached to this creature, e.g. Ethereal
   * Armor's first strike (issue #2464). Maintained by `refreshAuraBonuses`.
   */
  auraKeywords?: string[];
  /**
   * Names of scripted Auras attached to this permanent that set
   * `static.restrictAttack` (e.g. Pacifism, issue #2568). Maintained by
   * `refreshAuraBonuses`; consumed by `canAttack` to refuse attacks
   * (CR 303.4, "Enchanted creature can't attack.").
   */
  auraRestrictAttack?: string[];
  /**
   * Names of scripted Auras attached to this permanent that set
   * `static.restrictBlock` (e.g. Pacifism, issue #2568). Maintained by
   * `refreshAuraBonuses`; consumed by `canBlock` to refuse blocks
   * (CR 303.4, "Enchanted creature can't block.").
   */
  auraRestrictBlock?: string[];
  /**
   * Names of scripted Auras attached to this permanent that set
   * `static.restrictUntap` (e.g. Imprisoned in the Moon, Starlight
   * Snare, #2594 #9). Maintained by `refreshAuraBonuses`; consumed
   * by `processUntapStep` to skip the untap ("Enchanted permanent
   * doesn't untap during your untap step.").
   */
  auraRestrictUntap?: string[];
  /**
   * The most creatures that can block this permanent, from a scripted Aura's
   * `static.maxBlockers` ("can't be blocked by more than one creature",
   * Meltstrider's Resolve, #2614). Maintained by `refreshAuraBonuses`;
   * enforced in `declareBlockers` (CR 509.1b).
   */
  auraMaxBlockers?: number;
  /**
   * Summed static bonus from Equipment attached to this creature, e.g.
   * Swiftfoot Boots' hexproof+haste (issue #2561). Maintained by
   * `refreshEquipmentBonuses`. Kept separate from `auraPT` so a future
   * "lose all abilities" effect can drop Auras without dropping the
   * equipment that grants trample.
   */
  equipmentPT?: { power: number; toughness: number };
  /**
   * Keywords granted by Equipment attached to this creature (issue #2561).
   * Maintained by `refreshEquipmentBonuses`. See `equipmentPT` for why
   * the field is separate from `auraKeywords`.
   */
  equipmentKeywords?: string[];
  /**
   * Summed P/T from scripted static abilities on the battlefield, e.g. Anthem
   * of Champions (issue #2496). Maintained by `refreshScriptedStatics`.
   */
  scriptStaticPT?: { power: number; toughness: number };
  /**
   * Keywords granted by scripted static abilities, e.g. Samut's haste
   * (issue #2496). Maintained by `refreshScriptedStatics`.
   */
  scriptStaticKeywords?: string[];
  /**
   * "Cards exiled with this creature" (#2614 Keen-Eyed Curator, CR 607.2a):
   * the scripted source that exiled this card, keyed by that source's
   * battlefield timestamp so a new object (CR 400.7) starts with none.
   */
  exiledWith?: { sourceId: CardInstanceId; timestamp: number };
  /**
   * "Becomes a N/N creature until end of turn" (#2614 Soulstone Sanctuary):
   * the printed card data to restore at end of turn or when the permanent
   * leaves the battlefield. While set, `cardData` carries the animated type
   * line and base power/toughness.
   */
  /** Turn a once-each-turn crime trigger last fired (#2614 Magda). */
  crimeTriggerTurn?: number;
  /**
   * Set while this land is earthbent (#2614): `cardData` carries the 0/0
   * creature type line, and this keeps the printed card to restore.
   */
  earthbent?: { cardData: ScryfallCard };
  animatedUntilEndOfTurn?: {
    cardData: ScryfallCard;
    allCreatureTypes?: boolean;
  };
  /**
   * Keywords granted to this card's spell while it resolves (#2483): set
   * from the stack object's `grantedKeywords` for the duration of
   * `resolveTopOfStack`, so damage it deals sees them.
   */
  resolvingSpellKeywords?: string[];
  /**
   * Keywords granted "until end of turn" by a spell or ability's resolved
   * `GrantKeyword` op (issue #2567). Stored separately from
   * `auraKeywords`/`equipmentKeywords`/`scriptStaticKeywords` so the
   * cleanup step can drop the entire field without re-walking Auras or
   * Equipment. Consulted by `hasKeyword` alongside the other keyword
   * arrays; cleared at the cleanup step via
   * `clearGrantedKeywordsUntilEot`.
   *
   * CR 611.2a — a "grants X until end of turn" effect creates a continuous
   * effect that ends at the cleanup step (CR 514.2). The cleanup mirrors
   * the contract used by `untilEndOfTurnPT`.
   */
  grantedKeywordsUntilEot?: string[];

  // Renown keyword (CR 702.100)
  /**
   * Whether this permanent has become renowned (CR 702.100b).
   *
   * Set to `true` exactly once, the first time this creature's Renown ability
   * resolves. Per CR 702.100b the renowned flag persists for the rest of the
   * game for THIS card instance — it is never reset by removing the +1/+1
   * counters and it blocks Renown from re-triggering even after a flicker /
   * zone-change that returns the same card instance to the battlefield. The
   * flag is the authoritative intervening-if guard for "if it isn't renowned"
   * on the trigger-system side.
   *
   * Optional so legacy state literals default to "not yet renowned" (read
   * with `?? false`).
   */
  renowned?: boolean;

  // Tribute keyword (CR 702.101)
  /**
   * Whether the Tribute cost for this permanent was paid as it entered the
   * battlefield (CR 702.101b).
   *
   * Set during `resolveTributeChoice`: `true` when the chosen opponent paid
   * the cost (and the secondary "tribute wasn't paid" triggered ability is
   * suppressed), `false` when they declined (and the secondary ability fires
   * normally). Undefined before the choice resolves. Persisted on the card so
   * the suppression survives any later state recomputation.
   */
  tributePaid?: boolean;

  // Performance optimization: zone lookup cache (CR 704 - SBA performance)
  /** The zone key where this card currently resides. Updated on zone changes for O(1) lookup */
  currentZoneKey: string | null;

  /**
   * The value of X chosen when this permanent was cast (CR 107.3, #2559).
   *
   * Set on the CardInstance as the spell resolves onto the battlefield (see
   * `resolveTopOfStack`). Preserved for the life of the permanent so that
   * later triggered and activated abilities — "Whenever this creature
   * attacks, draw X cards", "{X}, {T}: ..." — can look up the same X when
   * they go on the stack. The interpreter reads X from
   * `stackObject.variableValues.get("X")`; for a triggered or activated
   * ability the stack object is freshly created with no X (issue #2559),
   * so the engine seeds `variableValues` from `source.xValue` here.
   *
   * Undefined for non-X-cast permanents. Cleared on zone change (CR 400.7).
   */
  xValue?: number;

  // Phasing tracking (CR 702.19) - used to track that a card has been phased out even after it phases back in
  /** @internal Used by phasing system to track if a card has ever been phased out */
  _hasBeenPhasedOut?: boolean;
}

/**
 * Untap modifier hook (CR 502.2).
 *
 * Describes an effect that alters HOW or WHICH permanents untap during the
 * discrete untap step. This is the extension point for untap-modifying effects
 * such as "don't untap during your untap step" (`doesNotUntap`) or
 * "untap an additional land" (`forceUntap`). Processed by `processUntapStep`.
 */
export interface UntapModifier {
  /** Card that is the source of the modifier */
  sourceCardId: CardInstanceId;
  /** If true, the target permanent does not untap during the untap step */
  doesNotUntap?: boolean;
  /** If true, force the target permanent to untap even if another effect says otherwise */
  forceUntap?: boolean;
}

/**
 * A marker on a card (internally referred to as "counter" for compatibility)
 */
export interface Counter {
  /** Type of marker (e.g., "+1/+1", "charge", "feit", "verse", "time", "blood") */
  type: string;
  /** Number of markers of this type */
  count: number;
}
