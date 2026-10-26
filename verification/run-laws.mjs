// gdp-wired law suite for the mana pool and the turn structure.
//
// Proves laws about the stateful core of the rules engine with gdp-wired
// (https://gdpwired.dev): every law below is proven for EVERY sequence of
// operations and kernel-checked, or the suite fails. Deliberately broken
// variants are included as negative controls — if the prover ever starts
// accepting them, the suite fails too.
//
// Real code modelled:
//   src/lib/game-state/mana/mana-pool.ts     addMana / emptyManaPool
//   src/lib/game-state/mana/mana-payment.ts  spendMana / canAffordMana
//   src/lib/game-state/turn-phases.ts        advancePhase / startNextTurn /
//                                            addExtraTurn / playersGetPriority /
//                                            canCastSorcerySpeedSpells
//   src/lib/game-state/game-state/index.ts   advanceToNextPhase (first-strike
//                                            skip, CR 510.5; pool emptying, CR 500.4)
//
// Simplifications (see README.md for the full account): the mana model keeps
// one colored bucket (white) + colorless + the generic bucket — colored
// buckets are symmetric in the real code for every quantity these laws state.
// The models are drift-checked against the real functions by real-check.ts.
//
// Run: npm run test:laws   (exit 1 on any failed check)
import {bool, fun, proveDecision, proveSteps} from 'gdp-wired'
import {search} from 'gdp-wired/machine'
import {combinedRule, manaRule, manaRuleWatched, PhaseKind, turnRule} from './models.mjs'

let failures = 0
function expectProven(label, v) {
  const ok = v.proven === true && v.checked === true
  console.log(`${ok ? 'PASS' : 'FAIL'} proven: ${label}` + (ok ? '' : ` (why=${v.why ?? v.stuck ?? ''} goal=${v.goal ?? ''})`))
  if (!ok) failures++
}
function expectRefused(label, v) {
  const ok = v.proven === false
  console.log(`${ok ? 'PASS' : 'FAIL'} refused: ${label}`)
  if (!ok) failures++
}
function expectCrossCheck(label, r, laws, stepLaws) {
  const {checked, failure} = r.crossCheck(laws, stepLaws)
  const ok = failure === undefined
  console.log(`${ok ? 'PASS' : 'FAIL'} crossCheck: ${label} (${checked} runs${ok ? '' : `, failure=${failure}`})`)
  if (!ok) failures++
}

// ---------------------------------------------------------------- mana pool
const total = ({w, c, p}) => w.plus(c).plus(p)
const cost = ({sw, sc, sg}) => sw.plus(sc).plus(sg)

const mana = manaRule('mana-pool')
const manaLaws = [
  mana.stepLaw('a successful spend removes exactly the total cost',
    (b, a) => a.w.plus(a.c).plus(a.p).plus(cost(b)).eq(total(b)),
    (b) => b.op.is('spend').and(b.affordable)),
  mana.stepLaw('a refused spend leaves the pool unchanged',
    (b, a) => a.w.eq(b.w).and(a.c.eq(b.c), a.p.eq(b.p)),
    (b) => b.op.is('spend').and(b.affordable.not())),
  mana.stepLaw('a spend never increases any bucket',
    (b, a) => a.w.atMost(b.w).and(a.c.atMost(b.c), a.p.atMost(b.p)),
    (b) => b.op.is('spend')),
  mana.stepLaw('add increases the total by exactly the added amount and never decreases a bucket',
    (b, a) => total(a).eq(total(b).plus(b.aw).plus(b.ac).plus(b.ap))
      .and(a.w.atLeast(b.w), a.c.atLeast(b.c), a.p.atLeast(b.p)),
    (b) => b.op.is('add')),
  mana.stepLaw('empty sets the pool to zero',
    (b, a) => total(a).eq(0),
    (b) => b.op.is('empty')),
]
expectProven('mana-pool step laws (5)', proveSteps(mana, [], manaLaws))
expectCrossCheck('mana-pool', mana, [], manaLaws)

// Watched invariant: colorless spent never exceeds colorless added (ghost
// counters track the history; the pool buckets alone cannot state this).
const watched = manaRuleWatched('mana-pool-watched', false)
const neverOverspendC = watched.law('colorless spent never exceeds colorless added',
  ({spentC, addedC}) => spentC.atMost(addedC))
expectProven('mana-pool watched invariant', proveSteps(watched, [neverOverspendC], []))

// Negative control: spendMana with the colorless affordability check dropped.
const bug = manaRuleWatched('mana-pool-bug', true)
const bugConservation = bug.stepLaw('a successful spend removes exactly the total cost',
  (b, a) => a.w.plus(a.c).plus(a.p).plus(cost(b)).eq(b.w.plus(b.c).plus(b.p)),
  (b) => b.op.is('spend').and(b.affordable))
expectRefused('bug variant (dropped colorless check) conservation law', proveSteps(bug, [], [bugConservation]))
const bugInv = bug.law('colorless spent never exceeds colorless added',
  ({spentC, addedC}) => spentC.atMost(addedC))
expectRefused('bug variant watched invariant', proveSteps(bug, [bugInv], []))
const cex = search(bug.machine, bugInv)
const cexOk = !!cex && cex.trace.length === 1 && cex.trace[0].op === 1 && cex.trace[0].sc >= 1
console.log(`${cexOk ? 'PASS' : 'FAIL'} bug variant counterexample is one spend of un-added colorless: ${JSON.stringify(cex)}`)
if (!cexOk) failures++

// ------------------------------------------------------------ turn structure
const turn = turnRule('turn')
const turnLaws = [
  turn.stepLaw('advance moves exactly one step forward, and stays at cleanup',
    (b, a) => a.phase.index.eq(b.phase.index.plus(1)).or(
      b.phase.is('cleanup').and(a.phase.index.eq(b.phase.index))),
    (b) => b.op.is('advance')),
  turn.stepLaw('advance never changes turn number or extra turns',
    (b, a) => a.turnNum.eq(b.turnNum).and(a.extra.eq(b.extra)),
    (b) => b.op.is('advance')),
  turn.stepLaw('nextTurn resets to untap, bumps turn number (unless first of game), and consumes one extra turn',
    (b, a) => a.phase.is('untap')
      .and(b.firstGame.implies(a.turnNum.eq(b.turnNum)),
           b.firstGame.not().implies(a.turnNum.eq(b.turnNum.plus(1))),
           a.extra.eq(b.extra.minus(1))),
    (b) => b.op.is('nextTurn')),
  turn.stepLaw('addExtra only adds extra turns',
    (b, a) => a.extra.eq(b.extra.plus(b.n)).and(a.phase.index.eq(b.phase.index), a.turnNum.eq(b.turnNum)),
    (b) => b.op.is('addExtra')),
  turn.stepLaw('advanceSkip skips first-strike when nobody has it (from declare_blockers)',
    (b, a) => a.phase.is('combat_damage'),
    (b) => b.op.is('advanceSkip').and(b.phase.is('declare_blockers'), b.hasFirstStriker.not())),
  turn.stepLaw('advanceSkip enters first-strike when a striker exists (from declare_blockers)',
    (b, a) => a.phase.is('combat_damage_first_strike'),
    (b) => b.op.is('advanceSkip').and(b.phase.is('declare_blockers'), b.hasFirstStriker)),
]
expectProven('turn step laws (6)', proveSteps(turn, [], turnLaws))
expectCrossCheck('turn', turn, [], turnLaws)

// Negative control 1: a FALSE law — the low-level advancePhase does not skip
// the first-strike step by itself; the skip lives in the wrapper. This must
// stay refused, or the model no longer matches the code.
const wrongLaw = turn.stepLaw('FALSE: advance from declare_blockers skips first-strike by itself',
  (b, a) => a.phase.is('combat_damage'),
  (b) => b.op.is('advance').and(b.phase.is('declare_blockers')))
expectRefused('false law (advance skips first-strike by itself)', proveSteps(turn, [], [wrongLaw]))

// Negative control 2: advance wrapping cleanup -> untap inside the same turn.
const buggy = turnRule('turn-bug', 'wrap-at-cleanup')
const monoLaw = buggy.stepLaw('advance moves exactly one step forward, and stays at cleanup',
  (b, a) => a.phase.index.eq(b.phase.index.plus(1)).or(
    b.phase.is('cleanup').and(a.phase.index.eq(b.phase.index))),
  (b) => b.op.is('advance'))
expectRefused('bug variant (wrap at cleanup)', proveSteps(buggy, [], [monoLaw]))

// Decisions: playersGetPriority and canCastSorcerySpeedSpells as pure functions.
const priority = fun('players get priority')
  .inputs({phase: PhaseKind})
  .returns(({phase}) => ({allow: phase.is('untap').not().and(phase.is('cleanup').not())}))
for (const l of [
  priority.law('untap never gets priority', ({phase}) => phase.is('untap'), (out) => out.allow.not()),
  priority.law('cleanup never gets priority', ({phase}) => phase.is('cleanup'), (out) => out.allow.not()),
  priority.law('upkeep gets priority', ({phase}) => phase.is('upkeep'), (out) => out.allow),
  priority.law('a main phase gets priority', ({phase}) => phase.is('precombat_main'), (out) => out.allow),
]) expectProven(`priority: ${l.name}`, proveDecision(l))

const sorcery = fun('can cast sorcery-speed')
  .inputs({phase: PhaseKind, stackEmpty: bool})
  .returns(({phase, stackEmpty}) => ({
    allow: phase.is('precombat_main').or(phase.is('postcombat_main')).and(stackEmpty),
  }))
for (const l of [
  sorcery.law('sorcery never outside a main phase',
    ({phase}) => phase.is('precombat_main').not().and(phase.is('postcombat_main').not()),
    (out) => out.allow.not()),
  sorcery.law('sorcery never with a non-empty stack',
    ({stackEmpty}) => stackEmpty.not(), (out) => out.allow.not()),
  sorcery.law('sorcery allowed in precombat main with empty stack',
    ({phase, stackEmpty}) => [phase.is('precombat_main'), stackEmpty], (out) => out.allow),
]) expectProven(`sorcery: ${l.name}`, proveDecision(l))

// ------------------------------------------------- combined: CR 500.4 coupling
const game = combinedRule('phase-advance-empties-mana')
const gameLaws = [
  game.stepLaw('advancing a phase empties the mana pool (CR 500.4)',
    (b, a) => a.w.plus(a.c).plus(a.p).eq(0),
    (b) => b.op.is('advance')),
  game.stepLaw('advancing still moves exactly one phase step (or stays at cleanup)',
    (b, a) => a.phase.index.eq(b.phase.index.plus(1)).or(
      b.phase.is('cleanup').and(a.phase.index.eq(b.phase.index))),
    (b) => b.op.is('advance')),
  game.stepLaw('add and spend never change the phase',
    (b, a) => a.phase.index.eq(b.phase.index),
    (b) => b.op.is('add').or(b.op.is('spend'))),
]
expectProven('combined step laws (3)', proveSteps(game, [], gameLaws))
expectCrossCheck('combined', game, [], gameLaws)

if (failures > 0) {
  console.error(`\n${failures} law check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll law checks passed')
