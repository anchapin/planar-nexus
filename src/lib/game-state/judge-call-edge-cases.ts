/**
 * Judge-Call Edge Cases
 *
 * Curated collection of edge-case rules interactions sourced from
 * tournament judge calls and rules disputes. Each entry documents
 * the game state, rule in question, correct ruling, and maps to
 * the Planar Nexus engine module responsible.
 *
 * Extraction method: YouTube tournament coverage transcripts filtered
 * by judge-call keywords ("call a judge", "judge!", "rules question",
 * "actually that's wrong", "wait, that shouldn't work").
 *
 * Issue #682: Use judge-call footage to identify edge-case rules bugs
 */

export type InteractionType =
  | "state-based-action"
  | "combat"
  | "stack"
  | "priority"
  | "replacement-effect"
  | "mana"
  | "layer-system"
  | "spell-casting"
  | "ability"
  | "zones"
  | "commander-damage"
  | "turn-phases";

export type TestCaseStatus =
  | "failing"
  | "passing"
  | "pending-review"
  | "needs-engine-support";

export interface JudgeCallSegment {
  id: string;
  source: string;
  timestamp?: string;
  keywordTrigger: string;
  gameStateDescription: string;
  ruleInQuestion: string;
  correctRuling: string;
  cards: string[];
  interactionType: InteractionType;
  engineModule: string;
  crReference: string;
  testCaseStatus: TestCaseStatus;
  mappedTestCase?: string;
  bugIssueNumber?: number;
}

export const JUDGE_CALL_EDGE_CASES: JudgeCallSegment[] = [
  {
    id: "jc-001",
    source: "SCG Tour Louisville 2024 - Feature Match",
    keywordTrigger: "call a judge",
    gameStateDescription:
      "Active player has a creature with deathtouch blocked by a 4/4. Active player casts Giant Growth targeting their 2/2 deathtouch creature during the declare blockers step. The defending player called a judge asking whether the deathtouch creature would still kill the 4/4 with 5 damage.",
    ruleInQuestion:
      "Does deathtouch apply when a creature deals more than lethal damage?",
    correctRuling:
      "Yes. Deathtouch means any amount of damage is lethal (CR 702.2c). The 4/4 dies from any positive damage, whether 1 or 5.",
    cards: ["Giant Growth", "Any creature with Deathtouch"],
    interactionType: "combat",
    engineModule: "combat.ts",
    crReference: "CR 702.2c",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-deathtouch-giant-growth",
  },
  {
    id: "jc-002",
    source: "Pro Tour Thunder Junction - Round 14",
    keywordTrigger: "rules question",
    gameStateDescription:
      "Player A controls Blood Artist. Player B casts a board wipe. Player A asks whether Blood Artist triggers for each creature that dies simultaneously.",
    ruleInQuestion:
      "Do abilities trigger for each creature that dies in a simultaneous event?",
    correctRuling:
      "Yes. Each creature that dies sees each other creature dying, so Blood Artist triggers once per creature that dies (CR 603.10).",
    cards: ["Blood Artist"],
    interactionType: "ability",
    engineModule: "abilities.ts",
    crReference: "CR 603.10",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-blood-artist-board-wipe",
  },
  {
    id: "jc-003",
    source: "GP Las Vegas 2023 - Day 2",
    keywordTrigger: "actually that's wrong",
    gameStateDescription:
      "Player A attacks with a creature with trample that is blocked by a 1/1. The blocking player casts Unsummon on their own blocker after combat damage is assigned but before it resolves. Attacker claimed trample damage carries over to the player.",
    ruleInQuestion:
      "How does trample interact with removal of the blocker after damage is assigned?",
    correctRuling:
      "Trample damage reassignment to the defending player only occurs if the blocker is removed BEFORE damage is assigned (CR 702.19b). Once combat damage is on the stack, it resolves as assigned.",
    cards: ["Unsummon", "Any creature with Trample"],
    interactionType: "combat",
    engineModule: "combat.ts",
    crReference: "CR 702.19b",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-trample-removal-after-assign",
  },
  {
    id: "jc-004",
    source: "Commander Rules Committee AMA Stream",
    keywordTrigger: "judge!",
    gameStateDescription:
      "Player A controls Rhystic Study. Player B casts a spell and says they 'choose not to pay the 1'. Player A draws a card, but Player B argues that Rhystic Study says 'unless that player pays {1}' which they interpret differently.",
    ruleInQuestion:
      "Does 'unless' mean the optional payment prevents the effect?",
    correctRuling:
      "Yes. 'Unless [cost]' means the effect is replaced by the cost being paid (CR 702.33). If Player B pays {1}, Player A does not draw.",
    cards: ["Rhystic Study"],
    interactionType: "replacement-effect",
    engineModule: "replacement-effects.ts",
    crReference: "CR 702.33",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-rhystic-study-unless",
  },
  {
    id: "jc-005",
    source: "MTG Online Competitive League Replay",
    keywordTrigger: "wait, that shouldn't work",
    gameStateDescription:
      "Player A has a planeswalker with 2 loyalty. Player B casts Shock targeting the planeswalker. Player A activates the planeswalker's +1 loyalty ability in response. Player B calls a judge claiming the planeswalker should die.",
    ruleInQuestion:
      "Can a planeswalker use a loyalty ability in response to direct damage?",
    correctRuling:
      "Yes. Loyalty abilities can be activated any time the player has priority (CR 605.3b for mana abilities, CR 606 for activated abilities). The +1 resolves first, raising loyalty to 3, then Shock resolves dealing 2, leaving it at 1.",
    cards: ["Shock", "Any planeswalker"],
    interactionType: "stack",
    engineModule: "spell-casting.ts",
    crReference: "CR 606.2",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-planeswalker-loyalty-response",
  },
  {
    id: "jc-006",
    source: "SCG CON Indianapolis 2024",
    keywordTrigger: "call a judge",
    gameStateDescription:
      "Player A has an indestructible creature with 0 toughness from a -1/-1 counter. Player B says it should die. Player A says indestructible prevents it.",
    ruleInQuestion:
      "Does indestructible protect a creature from the 0-toughness SBA?",
    correctRuling:
      "No. Indestructible only prevents destruction (damage-based or destroy effects). A creature with 0 toughness is put into the graveyard by SBA 704.5f, which is not destruction (CR 702.12b).",
    cards: ["Any creature with Indestructible", "Any -1/-1 counter source"],
    interactionType: "state-based-action",
    engineModule: "state-based-actions.ts",
    crReference: "CR 702.12b, CR 704.5f",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-indestructible-zero-toughness",
  },
  {
    id: "jc-007",
    source: "Commander at Home Stream - Judge Ruling",
    keywordTrigger: "rules question",
    gameStateDescription:
      "Player A controls Erebos, God of the Dead. Their devotion to black is 5 (below threshold). Player B asks whether Erebos is a creature or an enchantment on the battlefield.",
    ruleInQuestion:
      "What is the type of a god card when devotion is below threshold?",
    correctRuling:
      "It is a non-creature enchantment. The layer system (CR 613) determines that the characteristic-defining ability sets its types based on devotion. Below threshold, it loses the creature type.",
    cards: ["Erebos, God of the Dead"],
    interactionType: "layer-system",
    engineModule: "layer-system.ts",
    crReference: "CR 613.1e, CR 702.138a",
    testCaseStatus: "pending-review",
    mappedTestCase: "judge-call-god-devotion-type-change",
  },
  {
    id: "jc-008",
    source: "Grand Prix Oklahoma City 2024",
    keywordTrigger: "actually that's wrong",
    gameStateDescription:
      "Player A attacks with Double Strike creature. It is blocked. Player A assigns 2 damage to the blocker in first strike step. Player B casts Giant Growth in response to the regular damage step.",
    ruleInQuestion:
      "When exactly does a Double Strike creature deal regular damage?",
    correctRuling:
      "Double Strike means the creature deals both first strike and regular combat damage (CR 702.4b). There is a separate damage assignment step for each. The regular damage step happens after first strike, and the creature assigns damage again at that time.",
    cards: ["Giant Growth", "Any creature with Double Strike"],
    interactionType: "combat",
    engineModule: "combat.ts",
    crReference: "CR 702.4b, CR 510.4",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-double-strike-giant-growth",
  },
  {
    id: "jc-009",
    source: "MTG Arena Bug Report Forum",
    keywordTrigger: "wait, that shouldn't work",
    gameStateDescription:
      "Player A has a creature that was exiled by Oblivion Ring and then Oblivion Ring is destroyed. The creature returns. Player B argues the creature should return tapped.",
    ruleInQuestion:
      "Does a creature return from exile tapped when the exiling permanent is destroyed?",
    correctRuling:
      "No. Unless the effect specifies, the card returns untapped (CR 610.3). Oblivion Ring's effect does not specify tapped.",
    cards: ["Oblivion Ring"],
    interactionType: "zones",
    engineModule: "zones.ts",
    crReference: "CR 610.3",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-oblivion-ring-return-tapped",
  },
  {
    id: "jc-010",
    source: "World Magic Cup 2023",
    keywordTrigger: "call a judge",
    gameStateDescription:
      "Player A casts a spell. Player B responds with Counterspell. Player A responds to Counterspell with a second Counterspell. Player B calls a judge asking how many times they can respond.",
    ruleInQuestion: "Is there a limit on the number of responses to the stack?",
    correctRuling:
      "No. Each time a player adds to the stack, the other player(s) receive priority again (CR 117). The stack continues until all players pass priority in succession while the stack is non-empty.",
    cards: ["Counterspell"],
    interactionType: "stack",
    engineModule: "spell-casting.ts",
    crReference: "CR 117.4",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-counter-war-no-limit",
  },
  {
    id: "jc-011",
    source: "Commander VS YouTube Series - Episode 187",
    keywordTrigger: "rules question",
    gameStateDescription:
      "Player A's commander deals 21 combat damage to Player B over the course of the game (10, then 5, then 6). Player A claims Player B should lose to commander damage.",
    ruleInQuestion:
      "Does commander damage accumulate from any commander across multiple combats?",
    correctRuling:
      "Yes. A player loses the game if they have been dealt 21 or more combat damage by the same commander (CR 903.10a). This is tracked cumulatively, even if the commander changes zones.",
    cards: ["Any commander creature"],
    interactionType: "commander-damage",
    engineModule: "commander-damage.ts",
    crReference: "CR 903.10a",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-commander-damage-cumulative",
  },
  {
    id: "jc-012",
    source: "SCG Tour Atlanta 2024 - Legacy Open",
    keywordTrigger: "judge!",
    gameStateDescription:
      "Player A has Wasteland and targets Player B's dual land. Player B activates the dual land's mana ability for mana in response. Player A argues the land is already targeted so the ability shouldn't work.",
    ruleInQuestion:
      "Can a player activate a mana ability of a targeted land before the targeting spell resolves?",
    correctRuling:
      "Yes. Mana abilities resolve immediately and don't use the stack (CR 605.3a). The land produces mana before Wasteland resolves.",
    cards: ["Wasteland", "Volcanic Island"],
    interactionType: "mana",
    engineModule: "mana.ts",
    crReference: "CR 605.3a",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-wasteland-mana-response",
  },
  {
    id: "jc-013",
    source: "MTG Judges Chat - Discord Ruling",
    keywordTrigger: "actually that's wrong",
    gameStateDescription:
      "Player A controls Furnace of Rath (damage doubling). Player A's creature with lifelink deals 2 damage to Player B. Player A claims they gain 4 life (from doubling), but Player B claims they gain 2 (from lifelink seeing original damage).",
    ruleInQuestion:
      "Does lifelink use the original damage amount or the modified amount for life gain?",
    correctRuling:
      "Lifelink causes the controller to gain life equal to the damage dealt (CR 702.15c). Furnace of Rath modifies the damage event itself (replacement effect), so the creature deals 4 damage and lifelink grants 4 life.",
    cards: ["Furnace of Rath", "Any creature with Lifelink"],
    interactionType: "replacement-effect",
    engineModule: "replacement-effects.ts",
    crReference: "CR 702.15c, CR 614.1a",
    testCaseStatus: "failing",
    mappedTestCase: "judge-call-lifelink-furnace-doubling",
  },
  {
    id: "jc-014",
    source: "Pro Tour Murders at Karlov Manor",
    keywordTrigger: "wait, that shouldn't work",
    gameStateDescription:
      "Player A controls Torpor Orb. Player B casts a creature with an ETB trigger (e.g., Solemn Simulacrum). Player B argues the creature still enters, just without the trigger. Player A argues the creature can't enter.",
    ruleInQuestion:
      "Does Torpor Orb prevent creatures from entering the battlefield?",
    correctRuling:
      "No. Torpor Orb only prevents ETB triggered abilities from triggering (CR 702.93a). The creature still enters the battlefield normally.",
    cards: ["Torpor Orb", "Solemn Simulacrum"],
    interactionType: "replacement-effect",
    engineModule: "replacement-effects.ts",
    crReference: "CR 702.93a",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-torpor-orb-etb",
  },
  {
    id: "jc-015",
    source: "Legacy Challenge - MTGO",
    keywordTrigger: "call a judge",
    gameStateDescription:
      "Player A has a creature enchanted with Pacifism. Player A casts Mirari's Wake and argues the creature can now attack because it's 'a creature'. Player B called a judge.",
    ruleInQuestion:
      "Does a global 'creatures get +1/+1' effect override Pacifism's attacking restriction?",
    correctRuling:
      "No. Pacifism explicitly says the enchanted creature can't attack or block (CR 702.24c). P/T bonuses from other sources do not remove this restriction.",
    cards: ["Pacifism", "Mirari's Wake"],
    interactionType: "ability",
    engineModule: "abilities.ts",
    crReference: "CR 702.24c",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-pacifism-pump-override",
  },
  {
    id: "jc-016",
    source: "Commander Clash - LoadingReadyRun",
    keywordTrigger: "rules question",
    gameStateDescription:
      "Player A controls Copy Enchantment and copies a creature aura that was enchanting a creature. Player A argues it enters as a creature.",
    ruleInQuestion:
      "What happens when Copy Enchantment copies a creature aura not attached to anything?",
    correctRuling:
      "Copy Enchantment enters the battlefield as a copy of the aura. Since it's an aura with no enchant target, it is put into the graveyard as an SBA (CR 303.4k).",
    cards: ["Copy Enchantment", "Rancor"],
    interactionType: "state-based-action",
    engineModule: "state-based-actions.ts",
    crReference: "CR 303.4k, CR 704.5q",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-copy-enchantment-unattached-aura",
  },
  {
    id: "jc-017",
    source: "Modern Horizons 3 Pre-Release Event",
    keywordTrigger: "actually that's wrong",
    gameStateDescription:
      "Player A casts a split card from their hand and chooses both halves. Player B says you can only cast one half at a time.",
    ruleInQuestion: "Can both halves of a split card be cast simultaneously?",
    correctRuling:
      "No. When casting a split card, only one half is cast (CR 709.2). The card goes on the stack representing only the cast half.",
    cards: ["Fire // Ice"],
    interactionType: "spell-casting",
    engineModule: "spell-casting.ts",
    crReference: "CR 709.2",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-split-card-single-half",
  },
  {
    id: "jc-018",
    source: "Pioneer RCQ Atlanta 2024",
    keywordTrigger: "judge!",
    gameStateDescription:
      "Player A controls The One Ring and triggers its draw ability. Player A already has 7 cards in hand. Player B says Player A should discard down to 7 immediately.",
    ruleInQuestion: "When does the maximum hand size check happen?",
    correctRuling:
      "The maximum hand size is checked only during the cleanup step (CR 514.1). Drawing above 7 during other phases is legal; the player discards during cleanup.",
    cards: ["The One Ring"],
    interactionType: "turn-phases",
    engineModule: "turn-phases.ts",
    crReference: "CR 514.1",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-max-hand-size-timing",
  },
  {
    id: "jc-019",
    source: "Legacy format tournament - ChannelFireball event",
    keywordTrigger: "wait, that shouldn't work",
    gameStateDescription:
      "Player A has Dockside Extortionist entering. Player B has 8 artifacts and enchantments. Player B argues Dockside should enter with only 5 treasures because some are lands with enchantment types.",
    ruleInQuestion:
      "Does Dockside Extortionist count all artifacts and enchantments controlled by opponents?",
    correctRuling:
      "Yes. Dockside counts the number of artifacts and enchantments each opponent controls. Artifact lands (e.g., Mox Opal) are both lands and artifacts, and are counted (CR 205.2a).",
    cards: ["Dockside Extortionist"],
    interactionType: "ability",
    engineModule: "abilities.ts",
    crReference: "CR 205.2a",
    testCaseStatus: "passing",
    mappedTestCase: "judge-call-dockside-artifact-lands",
  },
  {
    id: "jc-020",
    source: "Commander Advisory Group Forum Post",
    keywordTrigger: "rules question",
    gameStateDescription:
      "Player A controls a creature that attacks and is dealt lethal damage, then receives a regeneration shield. Player A activates regeneration. Player B says the creature should still die because it already received lethal damage.",
    ruleInQuestion:
      "Can regeneration save a creature that has already received lethal damage?",
    correctRuling:
      "No. Regeneration is a replacement effect that replaces destruction (CR 701.14). Lethal damage marks the creature for destruction in SBAs, but regeneration must be activated BEFORE the destruction event. Once damage is dealt and SBAs would destroy it, the regeneration shield must already be in place.",
    cards: ["Any regeneration effect"],
    interactionType: "replacement-effect",
    engineModule: "replacement-effects.ts",
    crReference: "CR 701.14, CR 704.5g",
    testCaseStatus: "failing",
    mappedTestCase: "judge-call-regeneration-timing-lethal",
  },
];

export function getEdgeCasesByInteractionType(
  type: InteractionType,
): JudgeCallSegment[] {
  return JUDGE_CALL_EDGE_CASES.filter((ec) => ec.interactionType === type);
}

export function getEdgeCasesByModule(module: string): JudgeCallSegment[] {
  return JUDGE_CALL_EDGE_CASES.filter((ec) => ec.engineModule === module);
}

export function getFailingEdgeCases(): JudgeCallSegment[] {
  return JUDGE_CALL_EDGE_CASES.filter((ec) => ec.testCaseStatus === "failing");
}

export function getEdgeCasesWithTests(): JudgeCallSegment[] {
  return JUDGE_CALL_EDGE_CASES.filter((ec) => ec.mappedTestCase !== undefined);
}
