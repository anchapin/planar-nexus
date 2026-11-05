// Rule definitions for the gdp-wired law suite (see run-laws.mjs for the laws
// and README.md for the full write-up). Each rule transcribes real engine code:
//   manaRule      <- src/lib/game-state/mana/mana-pool.ts + mana-payment.ts
//   turnRule      <- src/lib/game-state/turn-phases.ts (+ the advanceToNextPhase
//                    wrapper in src/lib/game-state/game-state/index.ts)
//   combinedRule  <- the CR 500.4 coupling inside advanceToNextPhase
// scripts/check-law-suite-drift.ts drift-checks these transcriptions
// against the real functions.
import {bool, min, nat, oneOf, rule, when} from 'gdp-wired'

export const MANA_OPS = oneOf('add', 'spend', 'empty')
export const MANA_INPUTS = {op: MANA_OPS, aw: nat, ac: nat, ap: nat, sw: nat, sc: nat, sg: nat}

function manaStep(bug) {
  return ({op, aw, ac, ap, sw, sc, sg, w, c, p, affordable}) => {
    const paying = op.is('spend').and(affordable)
    const adding = op.is('add')
    const emptying = op.is('empty')
    const wSpec = w.minus(sw), cSpec = c.minus(sc)
    const owed1 = sg.minus(min(p, sg))
    const cAfter = cSpec.minus(min(cSpec, owed1))
    const owed2 = owed1.minus(min(cSpec, owed1))
    const wAfter = wSpec.minus(min(wSpec, owed2))
    const pAfter = p.minus(min(p, sg))
    const out = {
      w: when(paying, wAfter, when(adding, w.plus(aw), when(emptying, 0, w))),
      c: when(paying, cAfter, when(adding, c.plus(ac), when(emptying, 0, c))),
      p: when(paying, pAfter, when(adding, p.plus(ap), when(emptying, 0, p))),
    }
    if (bug) return out // bug rule has no ghost fields in state; see manaRuleBug
    return out
  }
}

export function manaRule(name) {
  return rule(name)
    .inputs(MANA_INPUTS)
    .state({w: 0, c: 0, p: 0})
    .flags(({w, c, p, sw, sc, sg}) => ({
      affordW: w.atLeast(sw),
      affordC: c.atLeast(sc),
      affordG: p.plus(w.minus(sw)).plus(c.minus(sc)).atLeast(sg),
    }))
    .flags(({affordW, affordC, affordG}) => ({affordable: affordW.and(affordC, affordG)}))
    .step(manaStep(false))
}

// Watched variant: ghost counters addedC/spentC (proof instrumentation only).
// With bug=true the colorless affordability check is dropped, as in mana.mjs.
export function manaRuleWatched(name, bug) {
  return rule(name)
    .inputs(MANA_INPUTS)
    .state({w: 0, c: 0, p: 0, addedC: 0, spentC: 0})
    .flags(({w, c, p, sw, sc, sg}) => bug
      ? {affordW: w.atLeast(sw), affordG: p.plus(w.minus(sw)).plus(c.minus(sc)).atLeast(sg)}
      : {affordW: w.atLeast(sw), affordC: c.atLeast(sc), affordG: p.plus(w.minus(sw)).plus(c.minus(sc)).atLeast(sg)})
    .flags(bug
      ? ({affordW, affordG}) => ({affordable: affordW.and(affordG)})
      : ({affordW, affordC, affordG}) => ({affordable: affordW.and(affordC, affordG)}))
    .step(({op, aw, ac, ap, sw, sc, sg, w, c, p, addedC, spentC, affordable}) => {
      const paying = op.is('spend').and(affordable)
      const adding = op.is('add')
      const emptying = op.is('empty')
      const wSpec = w.minus(sw), cSpec = c.minus(sc)
      const owed1 = sg.minus(min(p, sg))
      const cAfter = cSpec.minus(min(cSpec, owed1))
      const owed2 = owed1.minus(min(cSpec, owed1))
      const wAfter = wSpec.minus(min(wSpec, owed2))
      const pAfter = p.minus(min(p, sg))
      return {
        w: when(paying, wAfter, when(adding, w.plus(aw), when(emptying, 0, w))),
        c: when(paying, cAfter, when(adding, c.plus(ac), when(emptying, 0, c))),
        p: when(paying, pAfter, when(adding, p.plus(ap), when(emptying, 0, p))),
        addedC: when(adding, addedC.plus(ac), addedC),
        spentC: when(paying, spentC.plus(sc), spentC),
      }
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
    .inputs({op: oneOf('advance', 'add', 'spend'), aw: nat, ac: nat, ap: nat, sw: nat, sc: nat, sg: nat})
    .state({w: 0, c: 0, p: 0, phase: PhaseKind.from('untap')})
    .flags(({w, c, p, sw, sc, sg}) => ({
      affordable: w.atLeast(sw).and(c.atLeast(sc),
        p.plus(w.minus(sw)).plus(c.minus(sc)).atLeast(sg)),
    }))
    .step(({op, aw, ac, ap, sw, sc, sg, w, c, p, phase, affordable}) => {
      const advancing = op.is('advance')
      const adding = op.is('add')
      const paying = op.is('spend').and(affordable)
      const wSpec = w.minus(sw), cSpec = c.minus(sc)
      const owed1 = sg.minus(min(p, sg))
      const cAfter = cSpec.minus(min(cSpec, owed1))
      const owed2 = owed1.minus(min(cSpec, owed1))
      const wAfter = wSpec.minus(min(wSpec, owed2))
      const pAfter = p.minus(min(p, sg))
      return {
        w: when(advancing, 0, when(paying, wAfter, when(adding, w.plus(aw), w))),
        c: when(advancing, 0, when(paying, cAfter, when(adding, c.plus(ac), c))),
        p: when(advancing, 0, when(paying, pAfter, when(adding, p.plus(ap), p))),
        phase: when(advancing, nextOf(phase), phase),
      }
    })
}
