/**
 * anchapin/manamind#86: inputs for manamind's exported `ForgePointerNet`
 * (`forge_pointer.onnx`, schema v1), built from a Forge-bridge view such as
 * Planar Nexus `playerView`.
 *
 * A line-for-line port of `card_features`, `global_features`, and
 * `name_bucket` in manamind `src/manamind/models/forge_pointer.py`, and of
 * `pack` in `src/manamind/models/forge_pointer_onnx.py`. The parity fixture
 * (`__tests__/fixtures/forge_pointer_v1_pack.json`) is that `pack` run on
 * manamind's own test decisions.
 */
import type { PlayerView, ViewCard } from "@/ai/simulation/player-view";

export const FORGE_POINTER_SCHEMA_VERSION = 1;
export const NAME_BUCKETS = 4096;
export const TYPE_WORDS = [
  "land",
  "creature",
  "instant",
  "sorcery",
  "enchantment",
  "artifact",
  "planeswalker",
  "basic",
  "legendary",
  "aura",
] as const;
export const PIPS = ["W", "U", "B", "R", "G", "C", "X"] as const;
export const PHASES = [
  "UNTAP",
  "UPKEEP",
  "DRAW",
  "MAIN1",
  "COMBAT_BEGIN",
  "COMBAT_DECLARE_ATTACKERS",
  "COMBAT_DECLARE_BLOCKERS",
  "COMBAT_FIRST_STRIKE_DAMAGE",
  "COMBAT_DAMAGE",
  "COMBAT_END",
  "MAIN2",
  "END_OF_TURN",
  "CLEANUP",
] as const;
export const DECISION_TYPES = ["priority", "attack", "block"] as const;
export const CARD_FEATURES = TYPE_WORDS.length + 5 + PIPS.length + 1;
export const GLOBAL_FEATURES = 10 + PHASES.length + 1 + DECISION_TYPES.length;

/** Graph input names, in manamind `INPUT_NAMES` order. */
export const FORGE_POINTER_INPUTS = [
  "hand_x",
  "hand_id",
  "hand_m",
  "bf_x",
  "bf_id",
  "bf_m",
  "obf_x",
  "obf_id",
  "obf_m",
  "gy_id",
  "gy_m",
  "ogy_id",
  "ogy_m",
  "glob",
  "pri_x",
  "pri_id",
  "pri_flags",
  "att_x",
  "att_id",
  "blk_x",
  "blk_id",
  "batt_x",
  "batt_id",
] as const;
export type ForgePointerInputName = (typeof FORGE_POINTER_INPUTS)[number];

/** A card dict as the bridge sends it; every field may be missing. */
export type BridgeCard = Partial<ViewCard>;

/** A priority option: the card plus whether it is a land play or a spell. */
export interface PriorityOption {
  card?: BridgeCard;
  land?: boolean;
  spell?: boolean;
  text?: string;
}

/** One decision: a seat's view plus what it is being asked. */
export type ForgeDecision = Partial<
  Omit<PlayerView, "hand" | "battlefield" | "opp_battlefield">
> & {
  hand?: BridgeCard[];
  battlefield?: BridgeCard[];
  opp_battlefield?: BridgeCard[];
  t?: string;
  /** Priority: `PriorityOption[]`; attack: the eligible creatures. */
  options?: Array<PriorityOption | BridgeCard>;
  blockers?: BridgeCard[];
  attackers?: BridgeCard[];
};

/** One graph input: float32 or int64 values with their shape. */
export type PackedInput =
  | { type: "float32"; data: Float32Array; dims: number[] }
  | { type: "int64"; data: BigInt64Array; dims: number[] };

export type PackedInputs = Record<ForgePointerInputName, PackedInput>;

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const utf8 = new TextEncoder();

/** `zlib.crc32(name.lower().encode("utf-8")) % NAME_BUCKETS`. */
export function nameBucket(name: string): number {
  return crc32(utf8.encode(name.toLowerCase())) % NAME_BUCKETS;
}

const COST_SYMBOL = /\{([^}]*)\}/g;

/** Numeric features for one card dict (manamind `card_features`). */
export function cardFeatures(card: BridgeCard): number[] {
  const typeLine = String(card.type ?? "").toLowerCase();
  const feats: number[] = TYPE_WORDS.map((w) => (typeLine.includes(w) ? 1 : 0));
  feats.push(
    Math.min(Number(card.cmc ?? 0), 15) / 10,
    Number(card.power ?? 0) / 10,
    Number(card.toughness ?? 0) / 10,
    card.tapped ? 1 : 0,
    card.sick ? 1 : 0,
  );
  const pips: Record<string, number> = {};
  for (const p of PIPS) pips[p] = 0;
  let generic = 0;
  for (const m of String(card.cost ?? "").matchAll(COST_SYMBOL)) {
    const sym = m[1];
    if (/^\d+$/.test(sym)) {
      generic += Number(sym);
      continue;
    }
    for (const ch of sym.split("/")) if (Object.hasOwn(pips, ch)) pips[ch] += 1;
  }
  for (const p of PIPS) feats.push(pips[p] / 5);
  feats.push(generic / 10);
  return feats;
}

/** Scalar game features (manamind `global_features`). */
export function globalFeatures(d: ForgeDecision): number[] {
  const life = d.life ?? [20, 20];
  const lib = d.library ?? [0, 0];
  const feats = [
    life[0] / 20,
    life[1] / 20,
    Math.min(d.turn ?? 0, 40) / 20,
    d.active ? 1 : 0,
    (d.hand ?? []).length / 7,
    (d.opp_hand_size ?? 0) / 7,
    lib[0] / 60,
    lib[1] / 60,
    (d.graveyard ?? []).length / 20,
    (d.opp_graveyard ?? []).length / 20,
  ];
  const phase = String(d.phase ?? "");
  const known = (PHASES as readonly string[]).includes(phase);
  for (const p of PHASES) feats.push(phase === p ? 1 : 0);
  feats.push(known ? 0 : 1);
  for (const t of DECISION_TYPES) feats.push(d.t === t ? 1 : 0);
  return feats;
}

function f32(values: number[], dims: number[]): PackedInput {
  return { type: "float32", data: Float32Array.from(values), dims };
}

function i64(values: number[], dims: number[]): PackedInput {
  return {
    type: "int64",
    data: BigInt64Array.from(values.map((v) => BigInt(v))),
    dims,
  };
}

/** Features, name buckets, and mask; one zero row when empty. */
function cards(list: BridgeCard[]): [PackedInput, PackedInput, PackedInput] {
  if (list.length === 0) {
    return [
      f32(new Array(CARD_FEATURES).fill(0), [1, CARD_FEATURES]),
      i64([0], [1]),
      f32([0], [1]),
    ];
  }
  return [
    f32(list.flatMap(cardFeatures), [list.length, CARD_FEATURES]),
    i64(
      list.map((c) => nameBucket(String(c.name ?? ""))),
      [list.length],
    ),
    f32(new Array(list.length).fill(1), [list.length]),
  ];
}

function names(list: string[]): [PackedInput, PackedInput] {
  if (list.length === 0) return [i64([0], [1]), f32([0], [1])];
  return [
    i64(
      list.map((n) => nameBucket(String(n))),
      [list.length],
    ),
    f32(new Array(list.length).fill(1), [list.length]),
  ];
}

/** Graph inputs for one decision (manamind `forge_pointer_onnx.pack`). */
export function packDecision(d: ForgeDecision): PackedInputs {
  const out = {} as PackedInputs;
  const zones: Array<["hand" | "bf" | "obf", BridgeCard[] | undefined]> = [
    ["hand", d.hand],
    ["bf", d.battlefield],
    ["obf", d.opp_battlefield],
  ];
  for (const [zone, list] of zones) {
    [out[`${zone}_x`], out[`${zone}_id`], out[`${zone}_m`]] = cards(list ?? []);
  }
  [out.gy_id, out.gy_m] = names(d.graveyard ?? []);
  [out.ogy_id, out.ogy_m] = names(d.opp_graveyard ?? []);
  const glob = globalFeatures(d);
  out.glob = f32(glob, [glob.length]);

  const options =
    d.t === "priority" ? ((d.options ?? []) as PriorityOption[]) : [];
  [out.pri_x, out.pri_id] = cards(options.map((o) => o.card ?? {}));
  const flags = options.flatMap((o) => [o.land ? 1 : 0, o.spell ? 1 : 0]);
  out.pri_flags = f32(flags.length ? flags : [0, 0], [
    Math.max(options.length, 1),
    2,
  ]);
  const attackers = d.t === "attack" ? ((d.options ?? []) as BridgeCard[]) : [];
  [out.att_x, out.att_id] = cards(attackers);
  const block = d.t === "block";
  [out.blk_x, out.blk_id] = cards(block ? (d.blockers ?? []) : []);
  [out.batt_x, out.batt_id] = cards(block ? (d.attackers ?? []) : []);
  return out;
}
