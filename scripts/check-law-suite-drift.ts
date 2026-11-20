// Model-vs-reality drift check for the gdp-wired law suite.
//
// Steps the compiled gdp-wired models (verification/models.mjs) and the REAL
// engine functions side by side on seeded random traces and compares every
// resulting state. The proofs in run-laws.mjs are only worth anything while
// the models match the code; if a future edit to spendMana / advancePhase &
// friends changes the projected behaviour, this check fails first.
//
// The 'advanceSkip' op (the advanceToNextPhase wrapper's first-strike skip)
// is not exercised here — the real wrapper needs a full GameState with combat
// state. Its two-step logic is transcribed in the model and law-checked in
// run-laws.mjs instead.
//
// Run: npm run test:laws:drift   (tsx; exit 1 on any mismatch)
import {addMana, emptyManaPool} from '../src/lib/game-state/mana/mana-pool'
import {spendMana} from '../src/lib/game-state/mana/mana-payment'
import {advancePhase, startNextTurn, addExtraTurn, createTurn} from '../src/lib/game-state/turn-phases'
// @ts-ignore plain-JS model module (the law suite is plain ESM by design)
import {manaRule, turnRule} from '../verification/models.mjs'

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20261026)
const ri = (n: number) => Math.floor(rand() * n)

// ---------- mana ----------
const mana = manaRule('mana-pool')
const shipped = mana.compiled()
const params = mana.encodeParams({})
let failures = 0
let steps = 0
let spendsOk = 0, spendsRefused = 0

for (let trace = 0; trace < 300; trace++) {
  const pid = 'p1'
  let real: any = {
    players: new Map([[pid, {id: pid, manaPool: {colorless: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, generic: 0}}]]),
    lastModifiedAt: 0,
  }
  let model = shipped.init(params)
  const len = 1 + ri(12)
  for (let i = 0; i < len; i++) {
    const op = ['add', 'spend', 'empty'][ri(3)] as string
    const input = {op, aw: ri(4), ac: ri(4), ap: ri(3), sw: ri(4), sc: ri(4), sg: ri(5)}
    if (op === 'add') {
      real = addMana(real, pid, {white: input.aw, colorless: input.ac, generic: input.ap})
    } else if (op === 'empty') {
      real = emptyManaPool(real, pid)
    } else {
      const before = real.players.get(pid).manaPool
      const res = spendMana(real, pid, {white: input.sw, colorless: input.sc, generic: input.sg})
      if (res.success) { spendsOk++; real = res.state } else {
        spendsRefused++
        const after = res.state.players.get(pid).manaPool
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          failures++; console.log('REAL BUG? refused spend changed the pool', {before, after, input})
        }
      }
    }
    model = shipped.step(params, model, mana.encodeInput(input))
    const m = mana.decode(model)
    const rp = real.players.get(pid).manaPool
    steps++
    if (m.w !== rp.white || m.c !== rp.colorless || m.p !== rp.generic) {
      failures++
      console.log('MISMATCH', {trace, i, input, model: m, real: rp})
      if (failures > 5) break
    }
  }
  if (failures > 5) break
}
console.log(`mana: ${steps} steps compared, spends ok=${spendsOk} refused=${spendsRefused}, failures=${failures}`)

// ---------- turn ----------
const turn = turnRule('turn')
const tShipped = turn.compiled()
let tFailures = 0
let tSteps = 0
for (let trace = 0; trace < 200; trace++) {
  let realTurn: any = createTurn('p1', 1, false)
  let model = tShipped.init(params)
  const len = 1 + ri(16)
  for (let i = 0; i < len; i++) {
    const op = ['advance', 'nextTurn', 'addExtra'][ri(3)] as string
    const input = {op, n: ri(3), firstGame: rand() < 0.2, hasFirstStriker: rand() < 0.5}
    if (op === 'advance') {
      realTurn = advancePhase(realTurn)
    } else if (op === 'nextTurn') {
      realTurn = startNextTurn(realTurn, 'p2', input.firstGame)
    } else {
      realTurn = addExtraTurn(realTurn, input.n)
    }
    model = tShipped.step(params, model, turn.encodeInput(input))
    const m = turn.decode(model)
    tSteps++
    if (m.phase !== realTurn.currentPhase || m.turnNum !== realTurn.turnNumber || m.extra !== realTurn.extraTurns) {
      tFailures++
      console.log('TURN MISMATCH', {trace, i, input, model: m, real: {phase: realTurn.currentPhase, turnNum: realTurn.turnNumber, extra: realTurn.extraTurns}})
      if (tFailures > 5) break
    }
  }
  if (tFailures > 5) break
}
console.log(`turn: ${tSteps} steps compared, failures=${tFailures}`)
if (failures + tFailures > 0) process.exit(1)
console.log('REAL-CODE CHECK: PASS')
