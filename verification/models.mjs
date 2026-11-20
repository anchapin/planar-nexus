// Rule definitions for the gdp-wired law suite (see run-laws.mjs for the laws
// and README.md for the full write-up). Each rule transcribes real engine code:
//   manaRule      <- src/lib/game-state/mana/mana-pool.ts + mana-payment.ts
//   turnRule      <- src/lib/game-state/turn-phases.ts (+ the advanceToNextPhase
//                    wrapper in src/lib/game-state/game-state/index.ts)
//   combinedRule  <- the CR 500.4 coupling inside advanceToNextPhase
// scripts/check-law-suite-drift.ts drift-checks these transcriptions
// against the real functions.
//
// The mana model covers the pool's seven buckets: the five colors
// (white, blue, black, red, green), colorless, and generic. The order in
// which a generic cost is paid is the engine's own order (generic bucket
// first, then colorless, then white, blue, black, red, green) — see
// MANA_SPEND_ORDER below and spendMana in
// src/lib/game-state/mana/mana-payment.ts.
import {bool, min, nat, oneOf, rule, when} from 'gdp-wired'

export const MANA_OPS = oneOf('add', 'spend', 'empty')

// The five colored buckets, in the engine's generic-spillover order (WUBRG).
export const COLOR_BUCKETS = ['w', 'u', 'b', 'r', 'g']
// Every bucket of the real pool: the five colors, colorless ('c') and the
// generic bucket ('p').
export const MANA_BUCKETS = [...COLOR_BUCKETS, 'c', 'p']
// The order in which spendMana pays a generic cost: the generic bucket
// first, then colorless, then white, blue, black, red, green.
export const MANA_SPEND_ORDER = ['p', 'c', ...COLOR_BUCKETS]

// One input per bucket and operation: 'a<bucket>' adds, 's<bucket>' spends.
// aw/au/ab/ar/ag = add white/blue/black/red/green, ac = add colorless,
// ap = add generic; sw/su/sb/sr/sg = spend those colors, sc = spend
// colorless, sp = spend generic.
export const manaAmountInputs = () => {
  const inputs = {}
  for (const k of MANA_BUCKETS) inputs['a' + k] = nat
  for (const k of MANA_BUCKETS) inputs['s' + k] = nat
  return inputs
}

export const MANA_INPUTS = {op: MANA_OPS, ...manaAmountInputs()}

export function manaState(extra = {}) {
  const state = {}
  for (const k of MANA_BUCKETS) state[k] = 0
  return {...state, ...extra}
}

// canAffordMana / spendMana's refusal checks: every colored bucket must
// cover its own cost, colorless must cover its own cost, and what is left
// of the generic bucket, of the colored buckets and of colorless must cover
// the generic cost.
function affordFlags(env, dropColorlessCheck) {
  const afford = {}
  for (const k of COLOR_BUCKETS) afford['afford' + k] = env[k].atLeast(env['s' + k])
  if (!dropColorlessCheck) afford.affordC = env.c.atLeast(env.sc)
  let available = env.p
  for (const k of COLOR_BUCKETS) available = available.plus(env[k].minus(env['s' + k]))
  available = available.plus(env.c.minus(env.sc))
  afford.affordG = available.atLeast(env.sp)
  return afford
}

function affordableFlag(env) {
  let acc = env.affordC
  for (const k of COLOR_BUCKETS) acc = acc.and(env['afford' + k])
  return {affordable: acc.and(env.affordG)}
}

// The spend itself, transcribed from spendMana: the generic bucket pays the
// generic cost first, then colorless, then the colors in WUBRG order; each
// colored bucket first pays its own cost, and only its leftover pays generic.
function spendOutcome(env) {
  let owed = env.sp
  const fromGeneric = min(env.p, owed)
  owed = owed.minus(fromGeneric)
  const out = {p: env.p.minus(fromGeneric)}
  const colorlessSpec = env.c.minus(env.sc)
  const fromColorless = min(colorlessSpec, owed)
  owed = owed.minus(fromColorless)
  out.c = colorlessSpec.minus(fromColorless)
  for (const k of COLOR_BUCKETS) {
    const spec = env[k].minus(env['s' + k])
    const used = min(spec, owed)
    owed = owed.minus(used)
    out[k] = spec.minus(used)
  }
  return out
}

function manaStep(env) {
  const paying = env.op.is('spend').and(env.affordable)
  const adding = env.op.is('add')
  const emptying = env.op.is('empty')
  const paid = spendOutcome(env)
  const out = {}
  for (const k of MANA_BUCKETS) {
    out[k] = when(paying, paid[k],
      when(adding, env[k].plus(env['a' + k]), when(emptying, 0, env[k])))
  }
  return out
}

export function manaRule(name) {
  return rule(name)
    .inputs(MANA_INPUTS)
    .state(manaState())
    .flags((env) => affordFlags(env, false))
    .flags(affordableFlag)
    .step(manaStep)
}

// Watched variant: ghost counters addedC/spentC (proof instrumentation only).
// With bug=true the colorless affordability check is dropped, as in mana.mjs.
export function manaRuleWatched(name, bug) {
  return rule(name)
    .inputs(MANA_INPUTS)
    .state(manaState({addedC: 0, spentC: 0}))
    .flags((env) => affordFlags(env, bug === true))
    .flags((env) => {
      if (bug === true) {
        let acc = env.affordG
        for (const k of COLOR_BUCKETS) acc = acc.and(env['afford' + k])
        return {affordable: acc}
      }
      return affordableFlag(env)
    })
    .step((env) => {
      const paying = env.op.is('spend').and(env.affordable)
      const adding = env.op.is('add')
      const emptying = env.op.is('empty')
      const paid = spendOutcome(env)
      const out = {}
      for (const k of MANA_BUCKETS) {
        out[k] = when(paying, paid[k],
          when(adding, env[k].plus(env['a' + k]), when(emptying, 0, env[k])))
      }
      out.addedC = when(adding, env.addedC.plus(env.ac), env.addedC)
      out.spentC = when(paying, env.spentC.plus(env.sc), env.spentC)
      return out
    })
}

export const PHASES = ['untap', 'upkeep', 'draw', 'precombat_main', 'begin_combat',
  'declare_attackers', 'declare_blockers', 'combat_damage_first_strike', 'combat_damage',
  'end_combat', 'postcombat_main', 'end', 'cleanup']
export const PhaseKind = oneOf(...PHASES)

export function nextOf(phase) {
  let out = phase
  for (let i = PHASES.length - 2; i >= 0; i--) {
    out = when(phase.is(PHASES[i]), phase.of(PHASES[i + 1]), out)
  }
  return out
}

export function turnRule(name, bug) {
  return rule(name)
    .inputs({op: oneOf('advance', 'advanceSkip', 'nextTurn', 'addExtra'), n: nat, firstGame: bool, hasFirstStriker: bool})
    .state({phase: PhaseKind.from('untap'), turnNum: 1, extra: 0})
    .step(({op, n, firstGame, hasFirstStriker, phase, turnNum, extra}) => {
      const adv = nextOf(phase)
      const skipped = when(hasFirstStriker, adv, nextOf(adv))
      const advSkip = when(adv.is('combat_damage_first_strike'), skipped, adv)
      const advMaybeBug = bug === 'wrap-at-cleanup'
        ? when(phase.is('cleanup'), phase.of('untap'), adv)
        : adv
      return {
        phase: when(op.is('advance'), advMaybeBug,
          when(op.is('advanceSkip'), advSkip,
            when(op.is('nextTurn'), phase.of('untap'), phase))),
        turnNum: when(op.is('nextTurn'), when(firstGame, turnNum, turnNum.plus(1)), turnNum),
        extra: when(op.is('nextTurn'), extra.minus(1),
          when(op.is('addExtra'), extra.plus(n), extra)),
      }
    })
}

export function combinedRule(name) {
  return rule(name)
    .inputs({op: oneOf('advance', 'add', 'spend'), ...manaAmountInputs()})
    .state({...manaState(), phase: PhaseKind.from('untap')})
    .flags((env) => affordFlags(env, false))
    .flags(affordableFlag)
    .step((env) => {
      const advancing = env.op.is('advance')
      const adding = env.op.is('add')
      const paying = env.op.is('spend').and(env.affordable)
      const paid = spendOutcome(env)
      const out = {}
      for (const k of MANA_BUCKETS) {
        out[k] = when(advancing, 0,
          when(paying, paid[k], when(adding, env[k].plus(env['a' + k]), env[k])))
      }
      out.phase = when(advancing, nextOf(env.phase), env.phase)
      return out
    })
}
