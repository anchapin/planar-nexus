/**
 * manamind simple ruleset, ported from `manamind/rules/simple.py` (#2378).
 *
 * The manamind difficulty tiers were trained and measured on this subset of
 * Magic: basic lands and vanilla creatures, no stack, two identical 40-card
 * decks, 20 life, no mulligans. A network only plays at its measured strength
 * on the same game, so this port has to match the Python engine move for move:
 * the same legal moves in the same order, the same zone ordering after every
 * action, and the same turn structure. `__tests__/simple-rules-parity.test.ts`
 * replays fixtures recorded from the Python engine to hold it to that.
 *
 * Everything here is pure and synchronous so it can run in Jest, on the main
 * thread, or inside the engine worker (#2417).
 */

export const SIMPLE_PHASES = ["main", "combat", "end"] as const;
export type SimplePhase = (typeof SIMPLE_PHASES)[number];

export const STARTING_HAND_SIZE = 7;
export const STARTING_LIFE = 20;

export interface SimpleCard {
  name: string;
  /** Converted mana cost. Lands are 0. */
  cmc: number;
  isLand: boolean;
  /** Creature power and toughness; null for lands. */
  power: number | null;
  toughness: number | null;
  tapped: boolean;
  summoningSick: boolean;
  attacking: boolean;
}

export interface SimplePlayer {
  life: number;
  hand: SimpleCard[];
  library: SimpleCard[];
  graveyard: SimpleCard[];
  battlefield: SimpleCard[];
  landsPlayedThisTurn: number;
}

export interface SimpleGameState {
  players: [SimplePlayer, SimplePlayer];
  turn: number;
  phase: SimplePhase;
  activePlayer: 0 | 1;
  priorityPlayer: 0 | 1;
}

/** Action types use the manamind `ActionType` values, which the model's schema names. */
export type SimpleMove =
  | { type: "play_land"; player: 0 | 1; card: string }
  | { type: "cast_spell"; player: 0 | 1; card: string }
  | { type: "declare_attackers"; player: 0 | 1; attackers: number[] }
  | {
      type: "declare_blockers";
      player: 0 | 1;
      /** Attacker battlefield index -> defender battlefield indices. */
      blockers: Record<number, number[]>;
    }
  | { type: "pass_priority"; player: 0 | 1 };

interface CardSpec {
  name: string;
  cmc: number;
  power: number | null;
  toughness: number | null;
}

/** The whole card pool: one basic land and five vanilla creatures. */
export const SIMPLE_CARD_POOL: Readonly<Record<string, CardSpec>> = {
  "Grizzly Bears": { name: "Grizzly Bears", cmc: 2, power: 2, toughness: 2 },
  "Hill Giant": { name: "Hill Giant", cmc: 4, power: 3, toughness: 3 },
  "Craw Wurm": { name: "Craw Wurm", cmc: 6, power: 6, toughness: 4 },
  "Runeclaw Bear": { name: "Runeclaw Bear", cmc: 2, power: 2, toughness: 2 },
  "Canopy Spider": { name: "Canopy Spider", cmc: 3, power: 1, toughness: 3 },
  Forest: { name: "Forest", cmc: 0, power: null, toughness: null },
};

/** 17 Forests and 23 creatures, in the Python deck-building order. */
const DECK_LIST: ReadonlyArray<[string, number]> = [
  ["Forest", 17],
  ["Grizzly Bears", 7],
  ["Runeclaw Bear", 6],
  ["Canopy Spider", 5],
  ["Hill Giant", 3],
  ["Craw Wurm", 2],
];

export function makeSimpleCard(name: string): SimpleCard {
  const spec = SIMPLE_CARD_POOL[name];
  if (!spec) {
    throw new Error(`unknown simple-mode card ${JSON.stringify(name)}`);
  }
  return {
    name: spec.name,
    cmc: spec.cmc,
    isLand: spec.power === null,
    power: spec.power,
    toughness: spec.toughness,
    tapped: false,
    summoningSick: false,
    attacking: false,
  };
}

export function buildSimpleDeck(): SimpleCard[] {
  const deck: SimpleCard[] = [];
  for (const [name, count] of DECK_LIST) {
    for (let i = 0; i < count; i++) deck.push(makeSimpleCard(name));
  }
  return deck;
}

function emptyPlayer(): SimplePlayer {
  return {
    life: STARTING_LIFE,
    hand: [],
    library: [],
    graveyard: [],
    battlefield: [],
    landsPlayedThisTurn: 0,
  };
}

/**
 * A game from explicit opening hands and library orders (top of library
 * first). Used to replay Python fixtures, where the deal comes from Python's
 * shuffle.
 */
export function createSimpleGameFromDeal(
  deal: ReadonlyArray<{ hand: readonly string[]; library: readonly string[] }>,
): SimpleGameState {
  const players = [0, 1].map((pid) => {
    const p = emptyPlayer();
    p.hand = deal[pid].hand.map(makeSimpleCard);
    p.library = deal[pid].library.map(makeSimpleCard);
    return p;
  }) as [SimplePlayer, SimplePlayer];
  return {
    players,
    turn: 1,
    phase: "main",
    activePlayer: 0,
    priorityPlayer: 0,
  };
}

/**
 * A freshly shuffled game. `random` returns floats in [0, 1); pass a seeded
 * generator for reproducible games. The shuffle does not reproduce Python's,
 * so seeds are not shared with manamind; replay a recorded deal for that.
 */
export function createSimpleGame(
  random: () => number = Math.random,
): SimpleGameState {
  const players = [0, 1].map(() => {
    const p = emptyPlayer();
    const deck = buildSimpleDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    p.hand = deck.slice(0, STARTING_HAND_SIZE);
    p.library = deck.slice(STARTING_HAND_SIZE);
    return p;
  }) as [SimplePlayer, SimplePlayer];
  return {
    players,
    turn: 1,
    phase: "main",
    activePlayer: 0,
    priorityPlayer: 0,
  };
}

export function cloneSimpleState(state: SimpleGameState): SimpleGameState {
  const clonePlayer = (p: SimplePlayer): SimplePlayer => ({
    life: p.life,
    landsPlayedThisTurn: p.landsPlayedThisTurn,
    hand: p.hand.map((c) => ({ ...c })),
    library: p.library.map((c) => ({ ...c })),
    graveyard: p.graveyard.map((c) => ({ ...c })),
    battlefield: p.battlefield.map((c) => ({ ...c })),
  });
  return {
    players: [clonePlayer(state.players[0]), clonePlayer(state.players[1])],
    turn: state.turn,
    phase: state.phase,
    activePlayer: state.activePlayer,
    priorityPlayer: state.priorityPlayer,
  };
}

export function isSimpleGameOver(state: SimpleGameState): boolean {
  return state.players.some((p) => p.life <= 0);
}

/** The winner's id, or null while the game is running. Player 0 is checked first, as in Python. */
export function simpleWinner(state: SimpleGameState): 0 | 1 | null {
  if (state.players[0].life <= 0) return 1;
  if (state.players[1].life <= 0) return 0;
  return null;
}

const isCreature = (c: SimpleCard) => !c.isLand;

export function availableMana(player: SimplePlayer): number {
  return player.battlefield.filter((c) => c.isLand && !c.tapped).length;
}

function castable(player: SimplePlayer, card: SimpleCard): boolean {
  return isCreature(card) && card.cmc <= availableMana(player);
}

function possibleAttackers(player: SimplePlayer): number[] {
  const out: number[] = [];
  player.battlefield.forEach((c, i) => {
    if (isCreature(c) && !c.tapped && !c.summoningSick) out.push(i);
  });
  return out;
}

function attackingIndices(player: SimplePlayer): number[] {
  const out: number[] = [];
  player.battlefield.forEach((c, i) => {
    if (c.attacking) out.push(i);
  });
  return out;
}

/** Attack with everything, or with each creature alone. */
function attackOptions(candidates: number[]): number[][] {
  if (candidates.length === 0) return [];
  const options: number[][] = [[...candidates]];
  if (candidates.length > 1) for (const idx of candidates) options.push([idx]);
  return options;
}

/** No blocks, each single blocker on each attacker, and one-for-one when the boards match in size. */
function blockOptions(
  defender: SimplePlayer,
  attackers: number[],
): Record<number, number[]>[] {
  if (attackers.length === 0) return [];
  const available: number[] = [];
  defender.battlefield.forEach((c, i) => {
    if (isCreature(c) && !c.tapped) available.push(i);
  });
  const options: Record<number, number[]>[] = [{}];
  for (const a of attackers)
    for (const b of available) options.push({ [a]: [b] });
  if (attackers.length === available.length && available.length > 1) {
    const all: Record<number, number[]> = {};
    attackers.forEach((a, i) => {
      all[a] = [available[i]];
    });
    options.push(all);
  }
  return options;
}

/** Every legal move for the player with priority, in manamind's order. Pass is always last. */
export function simpleLegalMoves(state: SimpleGameState): SimpleMove[] {
  const moves: SimpleMove[] = [];
  const pid = state.priorityPlayer;
  const player = state.players[pid];

  if (state.phase === "main") {
    if (player.landsPlayedThisTurn === 0) {
      const land = player.hand.find((c) => c.isLand);
      if (land) moves.push({ type: "play_land", player: pid, card: land.name });
    }
    const seen = new Set<string>();
    for (const card of player.hand) {
      if (!castable(player, card)) continue;
      const key = `${card.name}|${card.cmc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      moves.push({ type: "cast_spell", player: pid, card: card.name });
    }
  } else if (state.phase === "combat") {
    if (pid === state.activePlayer) {
      for (const subset of attackOptions(possibleAttackers(player))) {
        moves.push({
          type: "declare_attackers",
          player: pid,
          attackers: subset,
        });
      }
    } else {
      const attackers = attackingIndices(state.players[state.activePlayer]);
      for (const blockers of blockOptions(player, attackers)) {
        moves.push({ type: "declare_blockers", player: pid, blockers });
      }
    }
  }

  moves.push({ type: "pass_priority", player: pid });
  return moves;
}

function sameCard(a: SimpleCard, b: SimpleCard): boolean {
  return (
    a.name === b.name &&
    a.cmc === b.cmc &&
    a.power === b.power &&
    a.toughness === b.toughness &&
    a.tapped === b.tapped &&
    a.summoningSick === b.summoningSick &&
    a.attacking === b.attacking
  );
}

/**
 * Remove the first card equal in value to `card`. Python's `list.remove`
 * compares pydantic models by value, so when two identical creatures share a
 * zone it removes the earlier one even if the later one died. That changes
 * battlefield indices, so the port has to do the same.
 */
function removeByValue(zone: SimpleCard[], card: SimpleCard): boolean {
  const i = zone.findIndex((c) => sameCard(c, card));
  if (i < 0) return false;
  zone.splice(i, 1);
  return true;
}

function findInHand(
  player: SimplePlayer,
  name: string,
): SimpleCard | undefined {
  const spec = SIMPLE_CARD_POOL[name];
  return player.hand.find(
    (c) => c.name === name && (!spec || c.cmc === spec.cmc),
  );
}

function tapFor(player: SimplePlayer, amount: number): void {
  let remaining = amount;
  for (const card of player.battlefield) {
    if (remaining <= 0) break;
    if (card.isLand && !card.tapped) {
      card.tapped = true;
      remaining -= 1;
    }
  }
}

function resolveCombat(
  state: SimpleGameState,
  blocks: Record<number, number[]>,
): SimpleGameState {
  const attackerPlayer = state.players[state.activePlayer];
  const defenderPlayer = state.players[1 - state.activePlayer];
  const deadAttackers: SimpleCard[] = [];
  const deadBlockers: SimpleCard[] = [];

  attackerPlayer.battlefield.forEach((creature, idx) => {
    if (!creature.attacking) return;
    const blockers = (blocks[idx] ?? [])
      .filter((b) => b >= 0 && b < defenderPlayer.battlefield.length)
      .map((b) => defenderPlayer.battlefield[b]);
    if (blockers.length === 0) {
      defenderPlayer.life -= creature.power ?? 0;
      return;
    }
    let damageLeft = creature.power ?? 0;
    for (const blocker of blockers) {
      const toughness = blocker.toughness ?? 0;
      if (damageLeft >= toughness) deadBlockers.push(blocker);
      damageLeft -= toughness;
      if ((blocker.power ?? 0) >= (creature.toughness ?? 0)) {
        deadAttackers.push(creature);
      }
    }
  });

  for (const card of deadAttackers) {
    if (removeByValue(attackerPlayer.battlefield, card)) {
      attackerPlayer.graveyard.push(card);
    }
  }
  for (const card of deadBlockers) {
    if (removeByValue(defenderPlayer.battlefield, card)) {
      defenderPlayer.graveyard.push(card);
    }
  }
  for (const creature of attackerPlayer.battlefield) creature.attacking = false;
  return state;
}

function beginTurn(state: SimpleGameState, playerId: 0 | 1): SimpleGameState {
  state.activePlayer = playerId;
  state.priorityPlayer = playerId;
  state.phase = "main";
  state.turn += 1;
  const player = state.players[playerId];
  player.landsPlayedThisTurn = 0;
  for (const card of player.battlefield) {
    card.tapped = false;
    card.summoningSick = false;
    card.attacking = false;
  }
  // Drawing from an empty library is a loss; it's how stalled boards end.
  const drawn = player.library.shift();
  if (drawn === undefined) player.life = 0;
  else player.hand.push(drawn);
  return state;
}

function advancePhase(state: SimpleGameState): SimpleGameState {
  if (isSimpleGameOver(state)) return state;
  const idx = SIMPLE_PHASES.indexOf(state.phase);
  if (idx + 1 < SIMPLE_PHASES.length) {
    state.phase = SIMPLE_PHASES[idx + 1];
    state.priorityPlayer = state.activePlayer;
    return state;
  }
  return beginTurn(state, (1 - state.activePlayer) as 0 | 1);
}

/** Apply a move to a copy of the state and advance the game as far as it should go. */
export function applySimpleMove(
  gameState: SimpleGameState,
  move: SimpleMove,
): SimpleGameState {
  const state = cloneSimpleState(gameState);
  const player = state.players[move.player];

  switch (move.type) {
    case "play_land": {
      const card = findInHand(player, move.card);
      if (card) {
        removeByValue(player.hand, card);
        player.battlefield.push(card);
        player.landsPlayedThisTurn += 1;
      }
      return state;
    }
    case "cast_spell": {
      const card = findInHand(player, move.card);
      if (card && castable(player, card)) {
        tapFor(player, card.cmc);
        removeByValue(player.hand, card);
        card.summoningSick = true;
        player.battlefield.push(card);
      }
      return state;
    }
    case "declare_attackers": {
      for (const idx of move.attackers) {
        if (idx >= 0 && idx < player.battlefield.length) {
          const creature = player.battlefield[idx];
          creature.attacking = true;
          creature.tapped = true;
        }
      }
      state.priorityPlayer = (1 - state.activePlayer) as 0 | 1;
      return state;
    }
    case "declare_blockers":
      return advancePhase(resolveCombat(state, move.blockers));
    case "pass_priority": {
      if (
        state.phase === "combat" &&
        state.priorityPlayer !== state.activePlayer
      ) {
        resolveCombat(state, {});
      }
      return advancePhase(state);
    }
  }
}
