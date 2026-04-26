# Standard Format Modal Card Implementation Plan

**Generated:** 2026-04-22
**Scope:** Standard format cards requiring UI modals for player choices
**Total Standard Cards Analyzed:** 4,430

---

## Executive Summary

This plan identifies all Standard-legal cards requiring modal dialogs or choice interfaces for gameplay. These are cards where the player must make a choice during casting, resolution, or on enter-the-battlefield triggers.

**Total cards requiring modals:** ~480

---

## HIGH Priority Categories

### 1. [DONE] Shockland-style ETB (11 cards)

**Status:** ✅ Shockland modal already implemented
**Cards:**

- Blood Crypt, Breeding Pool, Godless Shrine, Hallowed Fountain
- Overgrown Farmland, Rootbound Defensive Line, Razorverge Thicket
- Sacred Foundry, Steam Vents, Stomping Ground, Temple Garden

**Implementation:** Dialog with "Enter Tapped" vs "Pay 2 Life" buttons

---

### 2. [IN PROGRESS] Basic Land Type Choice (1 card)

**Status:** 🔄 Modal UI implemented, full effect not yet
**Card:** Multiversal Passage

**Implementation:** Dialog with 5 basic land types (Plains, Island, Swamp, Mountain, Forest)

---

### 3. Choose One/Two Modal Spells (180 cards)

**Status:** 📋 TODO
**Priority:** HIGH

These are spells with format "Choose one — [Mode A] / [Mode B]" or "Choose two — [Mode A] / [Mode B] / [Mode C]"

**Examples:**
| Card | Type | Modes |
|------|------|-------|
| Abrade | Instant | Deal 3 damage OR Destroy artifact |
| Aerith Rescue Mission | Sorcery | Multiple combat tricks |
| Bloodthirsty Adversary | Creature | Pump self OR Create vampire token |

**Implementation Approach:**

- Create a generic `ModalSpellChoice` dialog component
- Parse number of modes from oracle text
- Display mode descriptions as buttons
- Return selected mode to spell casting logic

**Files to modify:**

- `src/app/(app)/game/[id]/page.tsx` - Add state and dialog
- `src/lib/game-state/spell-casting.ts` - Handle mode selection
- `src/lib/game-state/oracle-text-parser.ts` - Parse modes

---

## MEDIUM Priority Categories

### 4. X-Cost Spells (53 cards)

**Priority:** MEDIUM

Cards where you choose the value of X. Examples:

- `Alquist Proft, Master Sleuth` - Learn X
- `Analyze the Pollen` - Creates X clues
- ` Arbiter of Woe` - Deals X damage

**Implementation Approach:**

- Add X input modal with +/- controls
- Range based on available mana or game state
- Some cards may need target selection for X targets

**Files to modify:**

- `src/app/(app)/game/[id]/page.tsx` - Add X input state and dialog

---

### 5. Kicker/Multikicker (18 cards)

**Priority:** MEDIUM

Optional additional costs that can be paid. Examples:

- `Aang's Journey` - Kicker {2}{U}
- `Burst Lightning` - Kicker {1}{R}
- `Chocobo Kick` - Kicker {2}{W}

**Implementation Approach:**

- Before casting, show "Kicker" toggle option
- If checked, add mana cost and continue
- Or integrate into spell confirmation modal

---

### 6. Attraction (36 cards)

**Priority:** MEDIUM

Cards with the Attraction mechanic (Lottery mechanic from Unfinity). Players reveal cards from the top of their library.

**Implementation Approach:**

- Complex mechanic requiring dedicated UI
- Show "Attraction" roll/draw dialog
- Reveal top cards and resolve based on result

---

## LOW Priority Categories

### 7. Adventure/Fuse (217 cards)

**Priority:** LOW

Cards with Adventure or Fuse mechanics. Most are correctly handled by existing spell casting, but Fuse may need modal for choosing which half to cast.

**Implementation:** Likely just verification that Adventure casting works

---

### 8. You May... If You Do (225 cards)

**Priority:** LOW (but 225 cards)

This is a broad category including many "You may [do something]. If you do, [effect]" patterns. Most are handled correctly by existing targeting.

---

## Implementation Phases

### Phase 1: Core Infrastructure

- [ ] Create `ModalSpellDialog` component
- [ ] Add mode parsing to `oracle-text-parser.ts`
- [ ] Add `spellModeChoice` state to game page
- [ ] Implement `handleModeSelect` callback

### Phase 2: Modal Spells (Choose One/Two)

- [ ] Implement modal spell dialog UI
- [ ] Update spell casting to handle mode selection
- [ ] Test with Abrade (damage or destroy)
- [ ] Test with multi-mode spells (3+ modes)

### Phase 3: X-Cost Spells

- [ ] Create X input dialog component
- [ ] Validate X range based on mana available
- [ ] Integrate into spell casting flow

### Phase 4: Kicker/Multikicker

- [ ] Add kicker option to cast confirmation
- [ ] Update mana cost calculation

### Phase 5: Attraction (Future)

- [ ] Requires dedicated Attraction mechanic implementation
- [ ] Low priority as Attraction is from Unfinity (not frequently used)

---

## Card Count by Set

| Set                            | Code | Modal Cards |
| ------------------------------ | ---- | ----------- |
| Bloomburrow                    | blb  | ~25         |
| Foundations                    | fdn  | ~30         |
| Aetherdrift                    | aeg  | ~20         |
| Outlaws of Thunder Junction    | otj  | ~25         |
| Murders at Karlov Manor        | mkm  | ~20         |
| Lost Caverns of Ixalan         | lci  | ~20         |
| Phyrexia: All Will Be One      | one  | ~15         |
| March of the Machine           | mom  | ~25         |
| Wilds of Eldraine              | woe  | ~30         |
| The Lost Caverns               | lcc  | ~20         |
| Commander Masters              | mcc  | ~15         |
| Doctor Who                     | whi  | ~15         |
| Multiverse Legends             | mul  | ~10         |
| March of the Machine Commander | moc  | ~15         |
| Street Fighter                 | sfc  | ~10         |
| Fallout                        | pls  | ~10         |
| Ravnica Remastered             | rvr  | ~10         |
| Ixalan Remastered              | xlr  | ~5          |

---

## Verification Checklist

After implementing modal spell support, verify these cards:

### Basic Modal Spells

- [ ] Abrade (2 modes)
- [ ] Defossilize (2 modes)
- [ ] Heartless Lynx (2 modes)
- [ ] Get Lost (2 modes)
- [ ] In Too Deep (3 modes)
- [ ] Insidious Roots (3 modes)
- [ ] Polemarch (3 modes)

### Complex Modal Spells

- [ ] Whitewater Meddlerek (3 modes)
- [ ] Niv-Mizzet, Supreme (4 modes)

---

## Notes

1. **Double-Faced Cards:** Some modal cards are double-faced (e.g., Transform cards). The UI must handle card_faces array.

2. **Mode Display:** Modal spell dialogs should show full mode text, not truncated.

3. **Targeting:** Some modes require targets. The modal should detect this and chain to targeting mode.

4. **AI Handling:** AI opponent must also handle modal spell selection - update `ai-action-executor.ts`.

5. **Saving State:** Modal choices should be saved in game state for replay/sharing.

---

## Related Files

- `/src/app/(app)/game/[id]/page.tsx` - Main game page with existing shockland modal
- `/src/lib/game-state/spell-casting.ts` - Spell casting logic
- `/src/lib/game-state/oracle-text-parser.ts` - Oracle text parsing
- `/src/components/ui/dialog.tsx` - Modal component
- `/src/lib/game-state/keyword-actions.ts` - Card effect handling
