# Proposed GitHub Issues to Close Gaps

This document defines the necessary GitHub issues to track the progress of closing the identified gaps in the Planar Nexus project.

---

## 1. [Critical] Bridge Game Engine with UI Board (Issue #521 Refinement)

**Title:** Connect Single-Player UI to Game Engine for Playable Gameplay
**Labels:** `critical`, `gameplay`, `ui-integration`
**Priority:** Highest
**Description:**
The current `src/app/(app)/game/[id]/page.tsx` and `GameBoard` component are largely visual. Key interactive logic—such as playing a card, tapping for mana, or declaring attackers—is currently represented by `console.log` placeholders or TODOs.

**Tasks:**
- [ ] Implement `handleCardClick` in `src/app/(app)/game/[id]/page.tsx` to trigger engine actions (play, activate, cast).
- [ ] Implement `handleZoneClick` to allow selecting targets or zones for ability placement.
- [ ] Integrate `src/lib/game-state` (SBAs, Layers, Stack) with the React state of the game board.
- [ ] Ensure state updates from the engine correctly reflect in the `GameBoard` UI.
- [ ] Implement the Priority Loop: Allow players to pass priority and advance the phase.

---

## 2. [Critical] Resolve Test Infrastructure and CI/CD Failures (Issue #515)

**Title:** Fix Jest Dependency Conflicts and Restore CI Pipeline
**Labels:** `critical`, `infrastructure`, `tests`
**Priority:** Highest
**Description:**
Known dependency conflicts have caused test coverage failures, meaning the "Complete" engine logic (layers, SBAs) is not currently verified by a passing CI pipeline.

**Tasks:**
- [ ] Identify and resolve conflicting versions of Jest/React-Testing-Library in `package.json`.
- [ ] Fix failing tests in `src/lib/game-state/__tests__`.
- [ ] Ensure `npm test` runs without errors in a clean environment.
- [ ] Re-enable/Fix coverage reporting to ensure the engine is fully verified.

---

## 3. [High] Complete AI Proxy Migration and Security (Issue #522)

**Title:** Full Integration of Server-Side AI Proxy across All AI Flows
**Labels:** `high`, `security`, `ai`
**Priority:** High
**Description:**
While the server-side AI proxy infrastructure exists, it is not yet fully utilized by all AI components (Combat AI, Stack AI, Deck Coach). This is required for the "Bring Your Own Key" architecture to be secure.

**Tasks:**
- [ ] Update `CombatAI` to use `src/lib/ai-proxy-client.ts` instead of direct provider calls.
- [ ] Update `StackInteractionAI` to use the server-side proxy.
- [ ] Migrate `AIDeckCoach` flows to the proxy.
- [ ] Remove any remaining client-side API key exposures in AI providers.
- [ ] Verify rate limiting and logging on the server proxy.

---

## 4. [High] Action Validation and Rule Enforcement

**Title:** Implement Server/Engine-Side Action Validation
**Labels:** `high`, `rules`, `engine`
**Priority:** High
**Description:**
While `game-rules.ts` defines formats, the engine does not yet strictly enforce these rules during real-time UI interactions (e.g., preventing a player from playing two lands per turn).

**Tasks:**
- [ ] Create a `ValidationService` that checks proposed actions against `GameModeConfig`.
- [ ] Enforce "One land per turn" rule in the engine state transition.
- [ ] Validate mana costs are paid before an action is added to the stack.
- [ ] Prevent actions when a player does not have priority.

---

## 5. [Medium] Multiplayer Polish and Sync Verification (Issue #524)

**Title:** Robust Loading States and Peer Sync for Multiplayer
**Labels:** `medium`, `multiplayer`, `ux`
**Priority:** Medium
**Description:**
The transition to PeerJS needs better UX and reliability during peer connections and state synchronization.

**Tasks:**
- [ ] Add loading skeletons/spinners to the Lobby Browser (`src/app/(app)/lobby/page.tsx`).
- [ ] Implement a handshake protocol to verify state checksums between peers.
- [ ] Add "Reconnecting..." indicators for transient network drops.
- [ ] Resolve conflict resolution logic for simultaneous actions in P2P mode.

---

## 6. [Medium] Remove `any` Types from AI and Game State (Issue #516)

**Title:** Enforce Strict Typing in AI Flows and State Transitions
**Labels:** `medium`, `typescript`, `refactor`
**Priority:** Medium
**Description:**
Significant use of `any` in AI flows and game state conversions leads to potential runtime errors during complex state transitions.

**Tasks:**
- [ ] Replace `any` in `src/ai/providers/types.ts` and related flows with concrete interfaces.
- [ ] Define strict types for AI prompt responses and evaluation results.
- [ ] Update `GameState` converters to use type guards instead of casting to `any`.

---
