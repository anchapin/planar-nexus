import type { HeuristicCategory, HeuristicRecord } from "./types";

interface SeedTemplate {
  category: HeuristicCategory;
  title: string;
  description: string;
  action: string;
  reasoning: string;
  confidence: number;
  archetype?: string;
  format?: string;
  tags: string[];
}

function makeId(category: HeuristicCategory, index: number): string {
  return `seed_${category}_${index}`;
}

function sigHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++)
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function makeRecord(t: SeedTemplate, index: number): HeuristicRecord {
  const sig = `${t.category} | ${t.action} | ${t.reasoning} | ${t.archetype || "generic"} | ${t.format || "all"}`;
  return {
    id: makeId(t.category, index),
    category: t.category,
    title: t.title,
    description: t.description,
    game_state_signature: sig,
    state_hash: sigHash(sig),
    action: t.action,
    reasoning: t.reasoning,
    confidence: t.confidence,
    frequency: 1,
    archetype: t.archetype,
    format: t.format,
    tags: t.tags,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

const ATTACK_LINE_TEMPLATES: SeedTemplate[] = [
  {
    category: "attack_lines",
    title: "Wide board alpha strike",
    description:
      "When holding a wide creature advantage with power exceeding opponent life total, commit all attackers to close the game before the opponent can stabilize",
    action: "attack with all creatures",
    reasoning:
      "Wide board with total power exceeding opponent life total means they need to find a board wipe immediately; maximizing damage closes the window",
    confidence: 0.92,
    archetype: "aggressive",
    format: "all",
    tags: ["wide-board", "alpha", "race"],
  },
  {
    category: "attack_lines",
    title: "Reserve key evasive threat",
    description:
      "Hold back an evasive creature when the opponent has no flyers when the evasive threat represents a clock that can close alone",
    action: "hold back evasive creature, attack with ground forces",
    reasoning:
      "Evasive creatures provide inevitability as the opponent cannot block them; commit only ground creatures to pressure",
    confidence: 0.88,
    archetype: "midrange",
    format: "all",
    tags: ["evasion", "inevitability"],
  },
  {
    category: "attack_lines",
    title: "Set up lethal next turn",
    description:
      "When you have enough power to threaten lethal next turn, attack to maximize board advantage even if some creatures die",
    action: "attack with most creatures, accept trades",
    reasoning:
      "Even if some creatures die in combat, the remaining force creates an unblockable lethal threat next turn",
    confidence: 0.91,
    archetype: "midrange",
    format: "all",
    tags: ["lethal-setup", "two-turn-plan"],
  },
  {
    category: "attack_lines",
    title: "Sacrifice attack to drain removal",
    description:
      "Attack with a creature you expect to die to force the opponent to use removal on your terms rather than during their own turn",
    action: "attack with expendable creature",
    reasoning:
      "Forcing the opponent to use removal during combat step limits their ability to develop their board on their turn",
    confidence: 0.85,
    archetype: "midrange",
    format: "all",
    tags: ["bait-removal", "resource-denial"],
  },
  {
    category: "attack_lines",
    title: "Race with burn when both players low",
    description:
      "When both players are at low life totals, maximize damage output each turn to win the race",
    action: "attack with all creatures, no blocks",
    reasoning:
      "In a damage race the faster clock wins; holding back creatures reduces your own clock speed",
    confidence: 0.93,
    archetype: "aggressive",
    format: "all",
    tags: ["race", "low-life", "max-damage"],
  },
  {
    category: "attack_lines",
    title: "Pressure opponent with threats post-wipe",
    description:
      "After an opponent wipes the board, immediately deploy threats and attack to prevent them from rebuilding",
    action: "deploy land drop, cast creature, attack",
    reasoning:
      "Preventing the opponent from establishing a planeswalker or other threat advantage after a wipe is critical",
    confidence: 0.87,
    archetype: "aggressive",
    format: "all",
    tags: ["post-wipe", "pressure"],
  },
  {
    category: "attack_lines",
    title: "Attack into superior board for chip damage",
    description:
      "When behind on board, attack with evasive or unblockable threats for incremental damage rather than holding back",
    action: "attack with evasive threats only",
    reasoning:
      "When you cannot win through ground combat, evasive damage accumulates while the opponent is forced to block ground threats",
    confidence: 0.82,
    archetype: "control",
    format: "all",
    tags: ["evasion", "chip-damage"],
  },
  {
    category: "attack_lines",
    title: "Bait blocker for lethal",
    description:
      "Attack with a sacrificial creature specifically to bait a key blocker out of the way, opening lethal for the rest of your team",
    action: "attack with small creature first, then attack with rest",
    reasoning:
      "The opponent is forced to block the first attacker to preserve life, leaving the path clear for the second wave",
    confidence: 0.89,
    archetype: "aggressive",
    format: "all",
    tags: ["bait-blocker", "lethal"],
  },
  {
    category: "attack_lines",
    title: "Hold attackers with combat trick backup",
    description:
      "Hold creatures back when you have combat tricks in hand, only attacking when the trick creates a favorable trade",
    action: "attack selectively with trick backup",
    reasoning:
      "Combat tricks turn losing attacks into winning ones; patience maximizes their value",
    confidence: 0.86,
    archetype: "aggressive",
    format: "limited",
    tags: ["combat-trick", "timing"],
  },
  {
    category: "attack_lines",
    title: "Attack through planeswalker pressure",
    description:
      "When the opponent has a planeswalker generating value, prioritize attacking it over the opponent's face to remove the value engine",
    action: "attack planeswalker, not face",
    reasoning:
      "Planeswalker value accumulates faster than incremental face damage; removing it stabilizes the game",
    confidence: 0.9,
    archetype: "midrange",
    format: "all",
    tags: ["planeswalker", "pressure"],
  },
  {
    category: "attack_lines",
    title: "Trade when ahead on cards",
    description:
      "When you have more cards in hand than the opponent, trade creatures aggressively to reduce the game to a topdeck war you are more likely to win",
    action: "attack and accept all trades",
    reasoning:
      "Having more cards means each trade improves your relative position; reducing the board state simplifies the game in your favor",
    confidence: 0.84,
    archetype: "midrange",
    format: "all",
    tags: ["card-advantage", "trade"],
  },
  {
    category: "attack_lines",
    title: "Bypass chump blockers with trample",
    description:
      "When facing multiple small blockers and you have trample creatures, attack into them to deal excess trample damage",
    action: "attack with trample creatures",
    reasoning:
      "Trample damage goes through even when blocked; small blockers cannot prevent meaningful damage",
    confidence: 0.91,
    archetype: "midrange",
    format: "all",
    tags: ["trample", "damage-through"],
  },
  {
    category: "attack_lines",
    title: "Avoid attacking into open mana",
    description:
      "When the opponent has untapped mana and potential removal or combat tricks, hold back key creatures and only attack with expendable ones",
    action: "attack with smallest creatures only",
    reasoning:
      "Untapped mana represents potential responses; exposing your best creatures is high risk",
    confidence: 0.87,
    archetype: "midrange",
    format: "all",
    tags: ["open-mana", "risk-aversion"],
  },
  {
    category: "attack_lines",
    title: "Punish opponent tapped out",
    description:
      "When the opponent is tapped out, attack with everything including your most valuable creatures since they cannot respond",
    action: "attack with all creatures",
    reasoning:
      "A tapped-out opponent cannot cast instants, so attacks are safe from combat tricks and removal",
    confidence: 0.95,
    archetype: "all",
    format: "all",
    tags: ["tapped-out", "safe-attack"],
  },
  {
    category: "attack_lines",
    title: "Race with unblockable threat",
    description:
      "When you have an unblockable or shadow creature, prioritize attacking with it every turn to build a clock",
    action: "attack with unblockable threat",
    reasoning:
      "Unblockable damage is guaranteed; each turn of not attacking is wasted damage",
    confidence: 0.94,
    archetype: "all",
    format: "all",
    tags: ["unblockable", "guaranteed-damage"],
  },
];

const BLOCK_TEMPLATES: SeedTemplate[] = [
  {
    category: "block_assignments",
    title: "Double block to kill large threat",
    description:
      "Use two smaller blockers to kill a larger threat in combat when the combined toughness exceeds the attacker's power",
    action: "double block with two creatures",
    reasoning:
      "Trading two small creatures for one large threat is favorable when the large threat would dominate the board",
    confidence: 0.9,
    archetype: "midrange",
    format: "all",
    tags: ["double-block", "trade-up"],
  },
  {
    category: "block_assignments",
    title: "Let damage through to save blockers",
    description:
      "When the incoming damage is survivable, decline to block to preserve blockers for more threatening future attacks",
    action: "decline to block, take damage",
    reasoning:
      "Preserving blockers maintains board presence; life total is a resource that can be spent when not immediately lethal",
    confidence: 0.86,
    archetype: "control",
    format: "all",
    tags: ["preserve-blockers", "life-resource"],
  },
  {
    category: "block_assignments",
    title: "Block only with deathtouch",
    description:
      "When facing a large attack and you have a deathtouch creature, block with it to kill regardless of power/toughness",
    action: "block with deathtouch creature",
    reasoning:
      "Deathtouch kills any creature regardless of size; one-for-one trade eliminates the biggest threat",
    confidence: 0.93,
    archetype: "midrange",
    format: "all",
    tags: ["deathtouch", "efficient-trade"],
  },
  {
    category: "block_assignments",
    title: "Chump block with token to buy time",
    description:
      "When facing lethal or near-lethal damage, block with a token creature to buy one more turn to find an answer",
    action: "block with token creature",
    reasoning:
      "Tokens are expendable; buying one turn when facing lethal pressure is critical to finding removal or stabilization",
    confidence: 0.88,
    archetype: "control",
    format: "all",
    tags: ["chump-block", "stall", "token"],
  },
  {
    category: "block_assignments",
    title: "Block evasive threat with reach",
    description:
      "Use a reach creature to block a flying threat that ground creatures cannot interact with",
    action: "block flying creature with reach creature",
    reasoning:
      "Reach provides a dedicated answer to flying threats without sacrificing ground combat effectiveness",
    confidence: 0.92,
    archetype: "midrange",
    format: "all",
    tags: ["reach", "flying-defense"],
  },
  {
    category: "block_assignments",
    title: "Let trample through small blocker",
    description:
      "Do not block a trample creature with a small blocker since trample damage still goes through",
    action: "decline to block small trample attacker",
    reasoning:
      "Blocking a 5/5 trampler with a 1/1 still allows 4 damage through; the 1/1 is wasted",
    confidence: 0.89,
    archetype: "midrange",
    format: "all",
    tags: ["trample", "efficient-blocking"],
  },
  {
    category: "block_assignments",
    title: "Sacred block to save planeswalker",
    description:
      "When the opponent attacks your planeswalker, block with a creature to prevent the planeswalker from losing loyalty",
    action: "block planeswalker attacker",
    reasoning:
      "Planeswalkers generate ongoing value; sacrificing a creature to protect them preserves card advantage",
    confidence: 0.85,
    archetype: "control",
    format: "all",
    tags: ["planeswalker", "protect"],
  },
  {
    category: "block_assignments",
    title: "Multi-block with first strike",
    description:
      "When you have a first strike creature, arrange blocks so the first strike damage kills the attacker before it deals damage",
    action: "block with first striker at the front",
    reasoning:
      "First strike damage resolves first; killing the attacker before it strikes saves all other blockers",
    confidence: 0.91,
    archetype: "midrange",
    format: "all",
    tags: ["first-strike", "damage-order"],
  },
  {
    category: "block_assignments",
    title: "Redirect attack with goad or forced attack",
    description:
      "Use effects that force the opponent to attack a specific player or planeswalker to redirect damage away from you",
    action: "force attack redirection",
    reasoning:
      "Redirecting attacks in multiplayer or to planeswalkers reduces pressure on your life total",
    confidence: 0.8,
    archetype: "all",
    format: "commander",
    tags: ["redirect", "multiplayer"],
  },
  {
    category: "block_assignments",
    title: "Let shadow through, block ground",
    description:
      "When facing mixed shadow and ground creatures, block ground threats and let shadow through when life total is safe",
    action: "block ground creatures, let shadow through",
    reasoning:
      "Shadow can only be blocked by shadow; using ground blockers against shadow is impossible so focus on ground threats",
    confidence: 0.87,
    archetype: "midrange",
    format: "all",
    tags: ["shadow", "selective-block"],
  },
];

const COMBAT_TRICK_TEMPLATES: SeedTemplate[] = [
  {
    category: "combat_trick_timing",
    title: "Giant Growth after block declared",
    description:
      "Wait until the opponent declares blocks, then cast a pump spell on the blocked creature to kill the blocker and survive",
    action: "cast pump spell after blocks",
    reasoning:
      "Waiting until blocks are declared maximizes the trick value by turning a losing block into a favorable trade",
    confidence: 0.94,
    archetype: "aggressive",
    format: "limited",
    tags: ["pump", "timing", "after-blocks"],
  },
  {
    category: "combat_trick_timing",
    title: "Pre-combat removal on key blocker",
    description:
      "Cast removal on the opponent's best blocker before declaring attackers to clear the path",
    action: "cast removal pre-combat, then attack",
    reasoning:
      "Removing a blocker before combat ensures the opponent cannot rearrange blocks in response",
    confidence: 0.92,
    archetype: "aggressive",
    format: "all",
    tags: ["removal", "pre-combat", "clear-path"],
  },
  {
    category: "combat_trick_timing",
    title: "Flash creature as surprise blocker",
    description:
      "After the opponent declares attackers, cast a flash creature to block their biggest threat",
    action: "cast flash creature during declare blockers",
    reasoning:
      "Flash creatures provide unexpected blockers that the opponent could not account for when attacking",
    confidence: 0.93,
    archetype: "midrange",
    format: "all",
    tags: ["flash", "surprise-block"],
  },
  {
    category: "combat_trick_timing",
    title: "Hold trick for potential counter",
    description:
      "When the opponent has blue mana open, wait to cast combat tricks until they are low on mana or pass priority",
    action: "hold combat trick, pass priority",
    reasoning:
      "The opponent may have a counter; forcing them to spend mana on other things first makes the trick more likely to resolve",
    confidence: 0.84,
    archetype: "aggressive",
    format: "all",
    tags: ["counter-protection", "hold"],
  },
  {
    category: "combat_trick_timing",
    title: "Blessing on double-blocked creature",
    description:
      "When your creature is double-blocked, cast indestructible or damage prevention to keep it alive and kill both blockers",
    action: "cast protection spell on double-blocked creature",
    reasoning:
      "Saving a creature from a double block while killing both blockers is a three-for-one value play",
    confidence: 0.9,
    archetype: "midrange",
    format: "limited",
    tags: ["protection", "double-block", "value"],
  },
  {
    category: "combat_trick_timing",
    title: "Trick on unblocked attacker",
    description:
      "Cast a pump spell on an unblocked creature after the opponent has no blocks to maximize damage output",
    action: "cast pump on unblocked creature",
    reasoning:
      "Unblocked attackers deal full damage; adding power to an unblocked creature guarantees the extra damage reaches the opponent",
    confidence: 0.91,
    archetype: "aggressive",
    format: "all",
    tags: ["pump", "unblocked", "max-damage"],
  },
  {
    category: "combat_trick_timing",
    title: "First strike trick for lethal",
    description:
      "Cast a first strike granting spell on an attacker so it deals damage before the blocker, killing it before it deals damage back",
    action: "cast first strike spell during combat",
    reasoning:
      "First strike creates a one-sided damage step, allowing your creature to kill without dying",
    confidence: 0.89,
    archetype: "aggressive",
    format: "limited",
    tags: ["first-strike", "one-sided"],
  },
  {
    category: "combat_trick_timing",
    title: "Save creature from removal in combat",
    description:
      "When the opponent casts removal on your attacking creature, respond with a regeneration or protection spell",
    action: "respond to removal with protection",
    reasoning:
      "Stack-based responses to removal during combat preserve your board state and combat math",
    confidence: 0.88,
    archetype: "midrange",
    format: "all",
    tags: ["stack", "protection", "respond"],
  },
  {
    category: "combat_trick_timing",
    title: "Trick during damage step",
    description:
      "Cast a damage prevention spell after damage is assigned but before it resolves to negate combat damage",
    action: "cast prevent damage during damage step",
    reasoning:
      "The damage step window allows prevention after the opponent is committed to the attack",
    confidence: 0.83,
    archetype: "control",
    format: "all",
    tags: ["damage-step", "prevention"],
  },
  {
    category: "combat_trick_timing",
    title: "Pump for exact lethal",
    description:
      "Calculate exact damage needed and cast the minimum pump spell to achieve lethal, saving stronger tricks for later",
    action: "cast smallest sufficient pump spell",
    reasoning:
      "Overpumping wastes resources; using the minimum trick for lethal preserves cards in hand for future turns",
    confidence: 0.95,
    archetype: "aggressive",
    format: "all",
    tags: ["exact-lethal", "resource-efficiency"],
  },
];

const COUNTERSPELL_TEMPLATES: SeedTemplate[] = [
  {
    category: "counterspell_decisions",
    title: "Counter game-ending spell",
    description:
      "Always counter an opponent's spell that would immediately end the game if it resolves",
    action: "cast counterspell on game-ending spell",
    reasoning:
      "The highest-value counterspell use is preventing immediate game loss; all other uses are subordinate",
    confidence: 0.97,
    archetype: "control",
    format: "all",
    tags: ["game-ending", "must-counter"],
  },
  {
    category: "counterspell_decisions",
    title: "Hold counter for planeswalker",
    description:
      "Save your counterspell for the opponent's most valuable spell, typically a planeswalker or finisher",
    action: "hold counterspell, pass priority on lesser spells",
    reasoning:
      "Counterspells are limited resources; using them on minor threats leaves you defenseless against real threats",
    confidence: 0.9,
    archetype: "control",
    format: "all",
    tags: ["hold", "value-target"],
  },
  {
    category: "counterspell_decisions",
    title: "Counter mass removal",
    description:
      "Counter the opponent's board wipe to preserve your creatures and board advantage",
    action: "cast counterspell on board wipe",
    reasoning:
      "Board wipes reset the game; countering them preserves your investment in creatures",
    confidence: 0.92,
    archetype: "midrange",
    format: "all",
    tags: ["board-wipe", "preserve-board"],
  },
  {
    category: "counterspell_decisions",
    title: "Let small spell resolve, save counter",
    description:
      "When the opponent casts a low-impact spell, let it resolve to preserve the counter for a more threatening spell later",
    action: "let spell resolve, keep counterspell",
    reasoning:
      "Low-impact spells do not significantly affect the game state; the counter is more valuable later",
    confidence: 0.88,
    archetype: "control",
    format: "all",
    tags: ["resource-management", "let-resolve"],
  },
  {
    category: "counterspell_decisions",
    title: "Counter opponent's first meaningful spell",
    description:
      "In the early game, counter the opponent's first impactful play to set them back on tempo",
    action: "counter early game accelerator",
    reasoning:
      "Setting the opponent back in the early game disrupts their entire game plan",
    confidence: 0.85,
    archetype: "control",
    format: "all",
    tags: ["early-game", "tempo"],
  },
  {
    category: "counterspell_decisions",
    title: "Use counter on combo piece",
    description:
      "When facing a combo deck, counter the key combo piece rather than the enabler or mana accelerator",
    action: "counter the combo piece",
    reasoning:
      "Without the combo piece, the combo cannot win; enablers are replaceable",
    confidence: 0.94,
    archetype: "control",
    format: "all",
    tags: ["combo", "key-piece"],
  },
  {
    category: "counterspell_decisions",
    title: "Hold counter when opponent has backup",
    description:
      "When the opponent has multiple cards in hand, hold your counter unless a spell is immediately threatening",
    action: "hold counter, evaluate threat level",
    reasoning:
      "Multiple cards means the opponent likely has backup; using your counter now may leave you vulnerable to the real threat",
    confidence: 0.82,
    archetype: "control",
    format: "all",
    tags: ["hand-size", "uncertainty"],
  },
  {
    category: "counterspell_decisions",
    title: "Counter when tapped out on your turn",
    description:
      "If the opponent taps low on your turn, hold your counter for their turn when they are more likely to cast meaningful spells",
    action: "hold counter for opponent's turn",
    reasoning:
      "The opponent's main phase is when they cast their most impactful spells; counter then",
    confidence: 0.87,
    archetype: "control",
    format: "all",
    tags: ["timing", "opponent-turn"],
  },
  {
    category: "counterspell_decisions",
    title: "Let cantrip resolve to protect counter",
    description:
      "When the opponent casts a cantrip (draw spell), let it resolve rather than using a counter",
    action: "let cantrip resolve",
    reasoning:
      "Cantrips replace themselves; countering them is card disadvantage for you with no real board impact",
    confidence: 0.91,
    archetype: "control",
    format: "all",
    tags: ["cantrip", "card-disadvantage"],
  },
  {
    category: "counterspell_decisions",
    title: "Force counter with bait spell",
    description:
      "Cast a high-value spell to force the opponent to counter it, then follow up with your actual threat",
    action: "cast bait spell, then cast real threat",
    reasoning:
      "Drawing out a counter with a sacrifice play clears the way for your actual game plan",
    confidence: 0.83,
    archetype: "control",
    format: "all",
    tags: ["bait", "force-counter"],
  },
];

const MANA_SEQUENCING_TEMPLATES: SeedTemplate[] = [
  {
    category: "mana_sequencing",
    title: "Play land before creature",
    description:
      "Always play your land drop before casting creatures to ensure you have the mana available",
    action: "play land, then cast creature",
    reasoning:
      "Lands enter untapped; playing them first ensures maximum mana availability for spells",
    confidence: 0.96,
    archetype: "all",
    format: "all",
    tags: ["land-first", "max-mana"],
  },
  {
    category: "mana_sequencing",
    title: "Use dorks for mana before playing lands",
    description:
      "When you have mana dorks, tap them for mana before playing additional lands to maximize available mana in a single turn",
    action: "tap dorks first, then play lands",
    reasoning:
      "Mana dorks add to your total available mana; using them before land drops allows bigger plays in a single turn",
    confidence: 0.88,
    archetype: "ramp",
    format: "all",
    tags: ["mana-dork", "ramp"],
  },
  {
    category: "mana_sequencing",
    title: "Hold fetch land for end of turn",
    description:
      "Crack fetch lands at end of turn rather than during your main phase to keep options open and thin the deck",
    action: "crack fetch land end of turn",
    reasoning:
      "End-of-turn fetch keeps mana open for instants and provides deck thinning at no opportunity cost",
    confidence: 0.89,
    archetype: "all",
    format: "modern",
    tags: ["fetch-land", "end-of-turn", "deck-thinning"],
  },
  {
    category: "mana_sequencing",
    title: "Order multi-color lands for specific needs",
    description:
      "When playing multiple colored lands, sequence them to match the colors of spells you intend to cast",
    action: "play lands matching spell colors first",
    reasoning:
      "Sequencing land colors to match spell needs prevents color screw and maximizes mana efficiency",
    confidence: 0.87,
    archetype: "all",
    format: "all",
    tags: ["color-management", "mana-efficiency"],
  },
  {
    category: "mana_sequencing",
    title: "Float mana for instant speed",
    description:
      "At end of opponent's turn, if holding instant spells, consider leaving mana open rather than using it on sorcery-speed plays",
    action: "hold mana open for instant speed",
    reasoning:
      "Leaving mana open provides flexibility to respond to the opponent's actions on their turn",
    confidence: 0.85,
    archetype: "control",
    format: "all",
    tags: ["instant-speed", "flexibility"],
  },
  {
    category: "mana_sequencing",
    title: "Ramp into big spell ahead of curve",
    description:
      "Use mana ramp spells or creatures to cast expensive threats ahead of the normal curve",
    action: "cast ramp spell, then cast expensive creature",
    reasoning:
      "Ahead-of-curve threats are difficult for the opponent to deal with before they stabilize",
    confidence: 0.91,
    archetype: "ramp",
    format: "all",
    tags: ["ramp", "ahead-of-curve", "big-spell"],
  },
  {
    category: "mana_sequencing",
    title: "Use check lands after basic lands",
    description:
      "Play basic lands before check lands to ensure check lands enter untapped",
    action: "play basic land, then play check land",
    reasoning:
      "Check lands require basic land types; sequencing basics first guarantees they enter untapped",
    confidence: 0.93,
    archetype: "all",
    format: "all",
    tags: ["check-land", "enter-untapped"],
  },
  {
    category: "mana_sequencing",
    title: "Shock land before spell on turn 1",
    description:
      "When playing a shock land on turn 1, pay 2 life and use it immediately rather than waiting",
    action: "play shock land, pay 2 life, cast 1-drop",
    reasoning:
      "The tempo advantage of playing a 1-drop on turn 1 outweighs the 2 life cost in most matchups",
    confidence: 0.9,
    archetype: "aggressive",
    format: "all",
    tags: ["shock-land", "tempo", "turn-1"],
  },
  {
    category: "mana_sequencing",
    title: "Channel lands end of opponent's turn",
    description:
      "Activate channel lands at end of opponent's turn to create creatures or effects while maintaining sorcery-speed options on your turn",
    action: "activate channel land end of opponent's turn",
    reasoning:
      "Using channel abilities at end of turn preserves your main phase for other plays and provides surprise blockers",
    confidence: 0.82,
    archetype: "midrange",
    format: "all",
    tags: ["channel", "end-of-turn"],
  },
  {
    category: "mana_sequencing",
    title: "Crew vehicles before attacking",
    description:
      "Tap creatures to crew vehicles before declaring attackers to include vehicle power in the attack",
    action: "crew vehicle, then attack with it",
    reasoning:
      "Vehicles need to be crewed before they can attack or block; sequencing this correctly maximizes attack power",
    confidence: 0.94,
    archetype: "all",
    format: "all",
    tags: ["vehicle", "crew", "attack-phase"],
  },
];

const SIDEBOARD_TEMPLATES: SeedTemplate[] = [
  {
    category: "sideboard_swap",
    title: "Bring in removal for creature-heavy matchup",
    description:
      "When the opponent's deck is creature-heavy, swap out card draw for targeted removal spells",
    action: "board in removal, board out card draw",
    reasoning:
      "Removal is more impactful against creature decks where each creature represents a threat",
    confidence: 0.89,
    archetype: "all",
    format: "all",
    tags: ["removal", "creature-matchup"],
  },
  {
    category: "sideboard_swap",
    title: "Board in artifact/enchantment hate",
    description:
      "When the opponent has key artifacts or enchantments, bring in specific hate cards",
    action: "board in artifact/enchantment removal",
    reasoning:
      "Targeted hate cards are more efficient than generic removal for dealing with specific permanent types",
    confidence: 0.91,
    archetype: "all",
    format: "all",
    tags: ["hate", "artifact", "enchantment"],
  },
  {
    category: "sideboard_swap",
    title: "Board out sweepers for control matchup",
    description:
      "Against control opponents with few creatures, remove board wipe spells from the main deck",
    action: "board out sweepers, board in counterspells",
    reasoning:
      "Board wipes have few targets against control; counterspells are more impactful in this matchup",
    confidence: 0.88,
    archetype: "midrange",
    format: "all",
    tags: ["control-matchup", "sweeper"],
  },
  {
    category: "sideboard_swap",
    title: "Board in lifegain against burn",
    description:
      "Against burn-heavy decks, bring in lifegain effects and remove slow cards",
    action: "board in lifegain, board out slow spells",
    reasoning:
      "Lifegain directly counters the burn deck's strategy; gaining 3-5 life is often equivalent to countering a spell",
    confidence: 0.92,
    archetype: "all",
    format: "all",
    tags: ["lifegain", "burn-matchup"],
  },
  {
    category: "sideboard_swap",
    title: "Board in graveyard hate",
    description:
      "Against decks with graveyard recursion, bring in graveyard hate cards",
    action: "board in graveyard hate",
    reasoning:
      "Graveyard strategies become significantly weaker when their resource is removed; hate cards are efficient answers",
    confidence: 0.93,
    archetype: "all",
    format: "all",
    tags: ["graveyard", "hate"],
  },
  {
    category: "sideboard_swap",
    title: "Board in hand disruption",
    description:
      "Against combo or control, bring in discard or hand disruption effects",
    action: "board in Thoughtseize or similar",
    reasoning:
      "Hand disruption strips key pieces from combo or counters from control before they can be used",
    confidence: 0.9,
    archetype: "all",
    format: "all",
    tags: ["hand-disruption", "combo", "control"],
  },
  {
    category: "sideboard_swap",
    title: "Adjust creature size for ground stall",
    description:
      "When the board tends to stall with mid-size creatures, bring in larger threats that break through",
    action: "board in bigger creatures, board out small utility",
    reasoning:
      "Larger creatures break board stalls by demanding immediate answers or ending the game quickly",
    confidence: 0.84,
    archetype: "midrange",
    format: "all",
    tags: ["ground-stall", "bigger-threats"],
  },
  {
    category: "sideboard_swap",
    title: "Board in anti-flying defense",
    description:
      "When the opponent has significant flying threats, bring in reach/flying defense",
    action: "board in reach creatures or flying defense spells",
    reasoning:
      "Without air defense, flying creatures deal unchecked damage; reach provides efficient answers",
    confidence: 0.86,
    archetype: "midrange",
    format: "all",
    tags: ["flying", "reach", "defense"],
  },
  {
    category: "sideboard_swap",
    title: "Speed up against slow control",
    description:
      "Against slow control decks, board in faster threats and more aggressive cards",
    action: "board in cheaper threats, board out expensive spells",
    reasoning:
      "Speeding up puts pressure on control before they can establish their value engines",
    confidence: 0.87,
    archetype: "aggressive",
    format: "all",
    tags: ["speed-up", "control-matchup"],
  },
  {
    category: "sideboard_swap",
    title: "Board in specific archetype answers",
    description:
      "Research the opponent's archetype and bring in cards specifically effective against their strategy",
    action: "customize sideboard for specific archetype",
    reasoning:
      "Targeted sideboard cards have outsized impact because they directly attack the opponent's strategy",
    confidence: 0.85,
    archetype: "all",
    format: "all",
    tags: ["archetype", "targeted"],
  },
];

const MULLIGAN_TEMPLATES: SeedTemplate[] = [
  {
    category: "mulligan_threshold",
    title: "Keep 7 with 2-land hand",
    description:
      "Always keep a 7-card hand with 2 lands, appropriate spells, and a curve that allows consistent play",
    action: "keep the opening hand",
    reasoning:
      "2 lands with a good mix of spells is the most consistent opening for most decks",
    confidence: 0.95,
    archetype: "all",
    format: "all",
    tags: ["keep", "2-land", "good-curve"],
  },
  {
    category: "mulligan_threshold",
    title: "Mulligan 0-land hand",
    description:
      "Always send back a hand with 0 lands as it cannot cast any spells",
    action: "mulligan the hand",
    reasoning:
      "A hand with no lands cannot participate in the game; a 6-card hand with lands is always better",
    confidence: 0.99,
    archetype: "all",
    format: "all",
    tags: ["mulligan", "0-land"],
  },
  {
    category: "mulligan_threshold",
    title: "Mulligan 1-land hand with no 2-drop",
    description:
      "A 1-land hand without a 2-drop is unreliable as it relies on drawing lands to function",
    action: "mulligan the hand",
    reasoning:
      "Missing land drops means no plays; the hand is too risky to keep",
    confidence: 0.92,
    archetype: "all",
    format: "all",
    tags: ["mulligan", "1-land", "unreliable"],
  },
  {
    category: "mulligan_threshold",
    title: "Keep 1-land with multiple 1-drops",
    description:
      "A 1-land hand with multiple 1-drops is keepable in aggressive decks since the 1-drops buy time to draw lands",
    action: "keep the hand",
    reasoning:
      "Aggressive decks can function on 1 land for several turns while deploying threats; the 1-drops create early pressure",
    confidence: 0.87,
    archetype: "aggressive",
    format: "all",
    tags: ["keep", "1-land", "aggressive", "1-drops"],
  },
  {
    category: "mulligan_threshold",
    title: "Keep 5-land hand with bomb",
    description:
      "A 5-land hand is keepable if it contains a game-winning bomb that can be cast immediately",
    action: "keep the hand",
    reasoning:
      "Having the land to cast a game-winning bomb immediately offsets the flood",
    confidence: 0.83,
    archetype: "ramp",
    format: "all",
    tags: ["keep", "5-land", "bomb"],
  },
  {
    category: "mulligan_threshold",
    title: "Mulligan 6-land hand",
    description:
      "A hand with 6+ lands is almost certainly a mulligan as you have no spells to cast",
    action: "mulligan the hand",
    reasoning:
      "Drawing 6 lands means you need to topdeck every spell; statistically this is losing",
    confidence: 0.97,
    archetype: "all",
    format: "all",
    tags: ["mulligan", "6-land", "flood"],
  },
  {
    category: "mulligan_threshold",
    title: "Keep land-spell-balanced 6-card",
    description:
      "After a mulligan to 6, keep a hand with 2-3 lands and a reasonable mix of spells",
    action: "keep the 6-card hand",
    reasoning:
      "Mulliganing further to 5 risks not having enough cards; a 2-3 land 6-card hand is serviceable",
    confidence: 0.89,
    archetype: "all",
    format: "all",
    tags: ["keep", "6-card", "balanced"],
  },
  {
    category: "mulligan_threshold",
    title: "Aggressive deck keep low-curve hand",
    description:
      "In aggressive decks, keep hands with low-curve threats even if slightly land-light",
    action: "keep low-curve aggressive hand",
    reasoning:
      "Aggressive decks need to deploy threats early; a hand with 1-drops and 2-drops is ideal even at 1 land",
    confidence: 0.9,
    archetype: "aggressive",
    format: "all",
    tags: ["keep", "low-curve", "aggressive"],
  },
  {
    category: "mulligan_threshold",
    title: "Control deck mulligan no-answer hand",
    description:
      "Control decks should mulligan a hand that lacks removal or counter magic as they cannot interact",
    action: "mulligan no-answer hand",
    reasoning:
      "Control decks need interactive tools; a hand of only lands and finishers cannot handle threats",
    confidence: 0.91,
    archetype: "control",
    format: "all",
    tags: ["mulligan", "no-answer", "control"],
  },
  {
    category: "mulligan_threshold",
    title: "Combo keep with 2 pieces",
    description:
      "Keep a hand that contains 2 of the 3 combo pieces even if slightly land-light",
    action: "keep combo hand",
    reasoning:
      "Having 2 combo pieces means only 1 more is needed; the faster the assembly the better",
    confidence: 0.93,
    archetype: "combo",
    format: "all",
    tags: ["keep", "combo", "2-pieces"],
  },
];

const ALL_TEMPLATES = [
  ...ATTACK_LINE_TEMPLATES,
  ...BLOCK_TEMPLATES,
  ...COMBAT_TRICK_TEMPLATES,
  ...COUNTERSPELL_TEMPLATES,
  ...MANA_SEQUENCING_TEMPLATES,
  ...SIDEBOARD_TEMPLATES,
  ...MULLIGAN_TEMPLATES,
];

const ARCHETYPE_VARIANTS = [
  "aggressive",
  "midrange",
  "control",
  "ramp",
  "combo",
  "all",
];
const FORMAT_VARIANTS = [
  "standard",
  "modern",
  "limited",
  "commander",
  "all",
  "pioneer",
  "historic",
];

function generateVariants(): SeedTemplate[] {
  const variants: SeedTemplate[] = [];
  let variantIndex = 0;

  for (const template of ALL_TEMPLATES) {
    for (const arch of ARCHETYPE_VARIANTS) {
      if (arch === template.archetype || arch === "all") continue;
      if (variantIndex >= 300) break;

      const archLabel = arch.charAt(0).toUpperCase() + arch.slice(1);
      const title = `${archLabel}: ${template.title}`;
      const description = `${template.description} Especially relevant for ${arch} archetypes.`;

      variants.push({
        category: template.category,
        title,
        description,
        action: template.action,
        reasoning: template.reasoning,
        confidence: Math.max(0.5, template.confidence - 0.1),
        archetype: arch,
        tags: [...template.tags, `archetype:${arch}`],
      });
      variantIndex++;
    }
    if (variantIndex >= 300) break;
  }

  return variants;
}

function generateFormatVariants(): SeedTemplate[] {
  const variants: SeedTemplate[] = [];
  let variantIndex = 0;

  for (const template of ALL_TEMPLATES) {
    for (const fmt of FORMAT_VARIANTS) {
      if (fmt === template.format || fmt === "all") continue;
      if (variantIndex >= 200) break;

      const fmtLabel = fmt.charAt(0).toUpperCase() + fmt.slice(1);
      const title = `${fmtLabel} rules: ${template.title}`;
      const description = `${template.description} Adapted for ${fmt} format considerations.`;

      variants.push({
        category: template.category,
        title,
        description,
        action: template.action,
        reasoning: template.reasoning,
        confidence: Math.max(0.5, template.confidence - 0.05),
        format: fmt,
        tags: [...template.tags, `format:${fmt}`],
      });
      variantIndex++;
    }
    if (variantIndex >= 200) break;
  }

  return variants;
}

const archetypeVariants = generateVariants();
const formatVariants = generateFormatVariants();

export function generateSeedRecords(): HeuristicRecord[] {
  const records: HeuristicRecord[] = [];

  let baseIndex = 0;
  for (const template of ALL_TEMPLATES) {
    records.push(makeRecord(template, baseIndex));
    baseIndex++;
  }

  for (const variant of archetypeVariants) {
    records.push(makeRecord(variant, baseIndex));
    baseIndex++;
  }

  for (const variant of formatVariants) {
    records.push(makeRecord(variant, baseIndex));
    baseIndex++;
  }

  return records;
}

export const SEED_RECORD_COUNT =
  ALL_TEMPLATES.length + archetypeVariants.length + formatVariants.length;
