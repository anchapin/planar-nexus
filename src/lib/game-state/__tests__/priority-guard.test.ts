/**
 * Unit tests for the shared priority-check helper (issue #1594).
 *
 * `isPriorityPlayer` is the single positive-form predicate that replaced the
 * 11 duplicated priority-inequality guards across the
 * rules-engine. These tests pin its contract directly, including the
 * `null`-priority boundary, so the extracted logic stays mutation-tested
 * independently of the migrated call sites.
 */

import { isPriorityPlayer } from "../priority-guard";

describe("isPriorityPlayer", () => {
  it("returns true when the player currently holds priority", () => {
    expect(isPriorityPlayer({ priorityPlayerId: "p1" }, "p1")).toBe(true);
  });

  it("returns false when another player holds priority", () => {
    expect(isPriorityPlayer({ priorityPlayerId: "p2" }, "p1")).toBe(false);
  });

  it("returns false when no player holds priority (null)", () => {
    expect(isPriorityPlayer({ priorityPlayerId: null }, "p1")).toBe(false);
  });

  it("is strict: does not coerce falsy player ids", () => {
    expect(isPriorityPlayer({ priorityPlayerId: "" }, "p1")).toBe(false);
    expect(isPriorityPlayer({ priorityPlayerId: "p1" }, "")).toBe(false);
  });
});
