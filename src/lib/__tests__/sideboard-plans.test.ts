/**
 * Unit tests for sideboard-plans.ts
 *
 * Phase 20-01: Custom Sideboard Plans — Requirement: SIDE-03
 *
 * Issue #1565 added: JSON export/import round-trip and quota-resilient writess.
 */

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, "localStorage", { value: localStorageMock });

import {
  generatePlanId,
  getAllSideboardPlans,
  getSideboardPlansByFormat,
  getSideboardPlanById,
  saveSideboardPlan,
  updateSideboardPlan,
  deleteSideboardPlan,
  clearAllSideboardPlans,
  validateSideboardPlan,
  exportAllSideboardPlans,
  exportAllSideboardPlansAsJson,
  importSideboardPlans,
  SIDEBOARD_PLAN_EXPORT_VERSION,
  SavedSideboardPlan,
} from "../sideboard-plans";

/** Convenience: a fully-formed SavedSideboardPlan with sensible defaults. */
function basePlan(
  overrides: Partial<SavedSideboardPlan> = {},
): SavedSideboardPlan {
  const now = new Date().toISOString();
  return {
    id: "test-id",
    name: "Test Plan",
    format: "standard",
    archetypeId: "test-archetype",
    archetypeName: "Test Archetype",
    opponentArchetypeId: "opp-archetype",
    opponentArchetypeName: "Opponent",
    inCards: [],
    outCards: [],
    notes: "Test notes",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Convenience: a SavedSideboardPlan input *without* the auto-generated
 *  fields (id/createdAt/updatedAt), as required by the saveSideboardPlan
 *  type signature. */
type SaveSideboardPlanInput = Parameters<typeof saveSideboardPlan>[0];
function saveInput(
  overrides: Partial<SaveSideboardPlanInput> = {},
): SaveSideboardPlanInput {
  return {
    name: "Test Plan",
    format: "standard",
    archetypeId: "test-archetype",
    archetypeName: "Test Archetype",
    opponentArchetypeId: "opp-archetype",
    opponentArchetypeName: "Opponent",
    inCards: [],
    outCards: [],
    notes: "Test notes",
    ...overrides,
  };
}

describe("sideboard-plans storage", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe("generatePlanId", () => {
    it("should generate unique IDs", () => {
      const id1 = generatePlanId();
      const id2 = generatePlanId();

      expect(id1).toMatch(/^sideboard-\d+-[a-z0-9]+$/);
      expect(id2).not.toBe(id1);
    });
  });

  describe("getAllSideboardPlans", () => {
    it("should return empty array when no plans exist", () => {
      const plans = getAllSideboardPlans();
      expect(plans).toEqual([]);
    });

    it("should return stored plans", () => {
      const result = saveSideboardPlan(saveInput({ name: "Test Plan" }));
      expect(result.success).toBe(true);
      const plans = getAllSideboardPlans();

      expect(plans.length).toBe(1);
      expect(plans[0].name).toBe("Test Plan");
    });
  });

  describe("getSideboardPlansByFormat", () => {
    it("should filter plans by format", () => {
      saveSideboardPlan(
        saveInput({ name: "Standard Plan", format: "standard" }),
      );
      saveSideboardPlan(saveInput({ name: "Modern Plan", format: "modern" }));

      const standardPlans = getSideboardPlansByFormat("standard");
      expect(standardPlans.length).toBe(1);
      expect(standardPlans[0].format).toBe("standard");
    });
  });

  describe("getSideboardPlanById", () => {
    it("should return null for non-existent plan", () => {
      const plan = getSideboardPlanById("non-existent");
      expect(plan).toBeNull();
    });

    it("should return the plan by ID", () => {
      const saved = saveSideboardPlan(saveInput({ name: "Test Plan" }));
      expect(saved.success).toBe(true);
      if (!saved.success) return;

      const plan = getSideboardPlanById(saved.plan.id);
      expect(plan).not.toBeNull();
      expect(plan?.name).toBe("Test Plan");
    });
  });

  describe("saveSideboardPlan", () => {
    it("should save a new plan with generated ID and timestamps", () => {
      const result = saveSideboardPlan({
        name: "New Plan",
        format: "commander",
        archetypeId: "cmdr-aggro",
        archetypeName: "Commander Aggro",
        opponentArchetypeId: "cmdr-control",
        opponentArchetypeName: "Commander Control",
        inCards: [
          {
            cardName: "Swords to Plowshares",
            count: 1,
            reason: "Remove creature",
          },
        ],
        outCards: [
          { cardName: "Counterspell", count: 1, reason: "Not needed" },
        ],
        notes: "Test notes",
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("expected success");
      expect(result.plan.id).toMatch(/^sideboard-/);
      expect(result.plan.createdAt).toBeDefined();
      expect(result.plan.updatedAt).toBeDefined();
      expect(result.plan.inCards.length).toBe(1);
      expect(result.plan.outCards.length).toBe(1);
    });
  });

  describe("updateSideboardPlan", () => {
    it("should update an existing plan", () => {
      const saved = saveSideboardPlan(saveInput({ name: "Original Name" }));
      if (!saved.success) throw new Error("expected save success");
      const savedPlan = saved.plan;

      const result = updateSideboardPlan(savedPlan.id, {
        name: "Updated Name",
        notes: "Added notes",
      });

      expect(result.success).toBe(true);
      if (!result.success) throw new Error("expected update success");
      expect(result.plan.name).toBe("Updated Name");
      expect(result.plan.notes).toBe("Added notes");
      expect(result.plan.id).toBe(savedPlan.id);
    });

    it("should return not-found for non-existent plan", () => {
      const result = updateSideboardPlan("non-existent", { name: "Test" });
      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure");
      expect(result.error).toBe("not-found");
    });
  });

  describe("deleteSideboardPlan", () => {
    it("should delete a plan", () => {
      const saved = saveSideboardPlan(saveInput({ name: "To Delete" }));
      if (!saved.success) throw new Error("expected save success");

      const deleted = deleteSideboardPlan(saved.plan.id);
      expect(deleted).toBe(true);

      const plan = getSideboardPlanById(saved.plan.id);
      expect(plan).toBeNull();
    });

    it("should return false for non-existent plan", () => {
      const result = deleteSideboardPlan("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("clearAllSideboardPlans", () => {
    it("should remove all plans", () => {
      saveSideboardPlan(saveInput({ name: "Plan 1", format: "standard" }));
      saveSideboardPlan(saveInput({ name: "Plan 2", format: "modern" }));

      clearAllSideboardPlans();

      const plans = getAllSideboardPlans();
      expect(plans.length).toBe(0);
    });
  });

  describe("validateSideboardPlan", () => {
    it("should return valid for complete plan", () => {
      const plan = {
        name: "Valid Plan",
        format: "standard" as const,
        archetypeId: "test",
        archetypeName: "Test",
        opponentArchetypeId: "opp",
        opponentArchetypeName: "Opponent",
        inCards: [{ cardName: "Test", count: 1, reason: "Test" }],
        outCards: [{ cardName: "Test", count: 1, reason: "Test" }],
      };

      const result = validateSideboardPlan(plan);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return errors for missing name", () => {
      const plan = {
        name: "",
        format: "standard" as const,
        archetypeId: "test",
        archetypeName: "Test",
        opponentArchetypeId: "opp",
        opponentArchetypeName: "Opponent",
        inCards: [],
        outCards: [],
      };

      const result = validateSideboardPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Plan name is required");
    });

    it("should return errors for missing format", () => {
      const plan = {
        name: "Test",
        format: "" as any,
        archetypeId: "test",
        archetypeName: "Test",
        opponentArchetypeId: "opp",
        opponentArchetypeName: "Opponent",
        inCards: [],
        outCards: [],
      };

      const result = validateSideboardPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Format is required");
    });

    it("should return errors for missing archetype", () => {
      const plan = {
        name: "Test",
        format: "standard" as const,
        archetypeId: "",
        archetypeName: "",
        opponentArchetypeId: "",
        opponentArchetypeName: "",
        inCards: [],
        outCards: [],
      };

      const result = validateSideboardPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Player archetype is required");
      expect(result.errors).toContain("Opponent archetype is required");
    });
  });
});

// ============================================================================
// #1565 — JSON export / import
// ============================================================================

describe("sideboard-plans JSON export / import (#1565)", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe("exportAllSideboardPlans", () => {
    it("returns a versioned envelope with empty plans when the store is empty", () => {
      const bundle = exportAllSideboardPlans();
      expect(bundle.version).toBe(SIDEBOARD_PLAN_EXPORT_VERSION);
      expect(bundle.version).toBe(1);
      expect(typeof bundle.exportedAt).toBe("string");
      // ISO timestamp shape: 2025-...T...Z
      expect(bundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(bundle.plans).toEqual([]);
    });

    it("returns a versioned envelope with the current plans", () => {
      const a = saveSideboardPlan(saveInput({ name: "Alpha" }));
      const b = saveSideboardPlan(
        saveInput({ name: "Beta", format: "modern" }),
      );
      if (!a.success || !b.success)
        throw new Error("expected saves to succeed");

      const bundle = exportAllSideboardPlans();
      expect(bundle.version).toBe(SIDEBOARD_PLAN_EXPORT_VERSION);
      expect(bundle.plans.map((p) => p.name).sort()).toEqual(["Alpha", "Beta"]);
    });

    it("exportAllSideboardPlansAsJson returns pretty-printed JSON", () => {
      saveSideboardPlan(saveInput({ name: "Pretty" }));
      const json = exportAllSideboardPlansAsJson();
      expect(typeof json).toBe("string");
      // pretty-print includes indentation
      expect(json).toContain("\n");
      // round-trips back to an object
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe(SIDEBOARD_PLAN_EXPORT_VERSION);
      expect(parsed.plans).toHaveLength(1);
    });
  });

  describe("export → import round-trip (issue #1565)", () => {
    it("preserves plan content end-to-end through merge import", () => {
      const a = saveSideboardPlan(
        saveInput({
          name: "Original A",
          notes: "Some long notes about how this matchup goes",
          inCards: [{ cardName: "Card In", count: 2, reason: "flex slot" }],
        }),
      );
      if (!a.success) throw new Error("expected save success");

      const json = exportAllSideboardPlansAsJson();
      // wipe the store to prove the import restores everything
      clearAllSideboardPlans();
      expect(getAllSideboardPlans()).toEqual([]);

      const result = importSideboardPlans(json);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.error).toBeUndefined();

      const restored = getSideboardPlanById(a.plan.id);
      expect(restored).not.toBeNull();
      expect(restored?.name).toBe("Original A");
      expect(restored?.notes).toBe(
        "Some long notes about how this matchup goes",
      );
      expect(restored?.inCards).toEqual([
        { cardName: "Card In", count: 2, reason: "flex slot" },
      ]);
    });

    it("export envelope is serialisable through JSON.stringify / JSON.parse", () => {
      saveSideboardPlan(saveInput({ name: "Ser" }));
      const json = JSON.stringify(exportAllSideboardPlans());
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe(1);
      expect(parsed.plans[0].name).toBe("Ser");
    });
  });

  describe("importSideboardPlans — version validation", () => {
    it("throws when version field is missing", () => {
      const json = JSON.stringify({ plans: [] });
      expect(() => importSideboardPlans(json)).toThrow(/unsupported version/);
    });

    it("throws when version is an unknown future version", () => {
      const json = JSON.stringify({ version: 99, plans: [] });
      expect(() => importSideboardPlans(json)).toThrow(
        /unsupported version "99"/,
      );
    });

    it("throws when JSON is malformed", () => {
      expect(() => importSideboardPlans("{not json")).toThrow(/invalid JSON/);
    });

    it("throws when payload is not an object", () => {
      expect(() => importSideboardPlans('"a string"')).toThrow(
        /must be an object/,
      );
      expect(() => importSideboardPlans("123")).toThrow(/must be an object/);
    });

    it("throws when plans field is missing or not an array", () => {
      const json = JSON.stringify({ version: 1 });
      expect(() => importSideboardPlans(json)).toThrow(
        /plans must be an array/,
      );

      const json2 = JSON.stringify({ version: 1, plans: "nope" });
      expect(() => importSideboardPlans(json2)).toThrow(
        /plans must be an array/,
      );
    });

    it("throws when json argument is not a string", () => {
      // @ts-expect-error — deliberate type violation for the runtime guard
      expect(() => importSideboardPlans(null)).toThrow(/json must be a string/);
    });
  });

  describe("importSideboardPlans — merge mode (issue #1565)", () => {
    it("imports new plans and skips ids that collide locally", () => {
      // local store: one plan with id "local-1"
      const localSaved = saveSideboardPlan(saveInput({ name: "Local A" }));
      if (!localSaved.success) throw new Error("expected save success");
      // overwrite its id to a stable value
      const plans = getAllSideboardPlans();
      plans[0].id = "local-1";
      localStorageMock.setItem(
        "planar-nexus-sideboard-plans",
        JSON.stringify(plans),
      );

      const incoming = {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        plans: [
          {
            ...basePlan({ name: "Incoming Same" }),
            id: "local-1", // collision
            notes: "newer version we are NOT going to take",
          },
          {
            ...basePlan({ name: "Incoming New" }),
            id: "incoming-1",
          },
        ],
      };

      const result = importSideboardPlans(JSON.stringify(incoming), {
        mode: "merge",
      });
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.error).toBeUndefined();

      const all = getAllSideboardPlans();
      expect(all.map((p) => p.id).sort()).toEqual(["incoming-1", "local-1"]);
      // local version preserved on collision
      const local = getSideboardPlanById("local-1");
      expect(local?.name).toBe("Local A");
      expect(local?.notes).not.toBe("newer version we are NOT going to take");
    });

    it("merge mode preserves a populated store", () => {
      const a = saveSideboardPlan(saveInput({ name: "A" }));
      if (!a.success) throw new Error("save failed");

      const incoming = {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        plans: [
          { ...basePlan({ name: "B" }), id: "imported-b" },
          { ...basePlan({ name: "C" }), id: "imported-c" },
        ],
      };

      const result = importSideboardPlans(JSON.stringify(incoming), {
        mode: "merge",
      });
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(getAllSideboardPlans()).toHaveLength(3);
    });

    it("defaults to merge when mode is omitted", () => {
      saveSideboardPlan(saveInput({ name: "Existing" }));
      const incoming = {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        plans: [{ ...basePlan({ name: "New" }), id: "new-1" }],
      };

      const result = importSideboardPlans(JSON.stringify(incoming));
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(getAllSideboardPlans()).toHaveLength(2);
    });
  });

  describe("importSideboardPlans — replace mode", () => {
    it("overwrites the entire store", () => {
      saveSideboardPlan(saveInput({ name: "Old" }));
      const incoming = {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        plans: [
          { ...basePlan({ name: "Fresh A" }), id: "a" },
          { ...basePlan({ name: "Fresh B" }), id: "b" },
        ],
      };
      const result = importSideboardPlans(JSON.stringify(incoming), {
        mode: "replace",
      });
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);

      const names = getAllSideboardPlans()
        .map((p) => p.name)
        .sort();
      expect(names).toEqual(["Fresh A", "Fresh B"]);
    });

    it("replace mode with empty plans clears the store", () => {
      saveSideboardPlan(saveInput({ name: "To Wipe" }));
      const incoming = { version: 1 as const, exportedAt: "", plans: [] };
      const result = importSideboardPlans(JSON.stringify(incoming), {
        mode: "replace",
      });
      expect(result.imported).toBe(0);
      expect(getAllSideboardPlans()).toEqual([]);
    });
  });

  describe("importSideboardPlans — shape filtering", () => {
    it("silently drops malformed plan entries", () => {
      const incoming = {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        plans: [
          { ...basePlan({ name: "Good" }), id: "good" },
          { name: "Missing many fields" }, // invalid
          "not even an object",
          null,
        ],
      };
      const result = importSideboardPlans(JSON.stringify(incoming));
      expect(result.imported).toBe(1);
      expect(getAllSideboardPlans()).toHaveLength(1);
    });
  });
});

// ============================================================================
// #1565 — Quota-resilient writes
// ============================================================================

describe("sideboard-plans quota-resilient writes (#1565)", () => {
  // The test-local `localStorageMock` is a plain object (NOT a Storage
  // instance), so swapping `Storage.prototype.setItem` does not affect what
  // production code calls. We override the mock's `setItem` directly; the
  // closure over its internal `store` is unaffected because the production
  // code reaches `localStorage` through `global.localStorage`, which is the
  // exact same object reference.
  let originalSetItem: (key: string, value: string) => void;

  beforeEach(() => {
    originalSetItem = localStorageMock.setItem;
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.setItem = originalSetItem;
  });

  function failNextSetItemTimes(
    times: number,
    quotaLike: "quota" | "other" = "quota",
  ) {
    let calls = 0;
    const err: Error & { name?: string } =
      quotaLike === "quota"
        ? Object.assign(new Error("quota"), { name: "QuotaExceededError" })
        : new Error("boom");
    const mock = localStorageMock as unknown as {
      setItem: (key: string, value: string) => void;
    };
    const orig = originalSetItem;
    mock.setItem = function (key: string, value: string): void {
      calls += 1;
      if (calls <= times) throw err;
      // fall through to the real mock for any subsequent calls
      return orig(key, value);
    };
  }

  describe("saveSideboardPlan", () => {
    it('returns a structured {success:false, error:"quota"} result instead of throwing', () => {
      // Fail BOTH the original write AND the compact retry. `times = 99`
      // ensures the override outlives any extra setItem call (e.g. reads
      // the test harness might perform after the write).
      failNextSetItemTimes(99, "quota");

      const result = saveSideboardPlan(saveInput({ name: "Boom" }));
      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure");
      expect(result.error).toBe("quota");
      expect(typeof result.message).toBe("string");
      expect(result.message.length).toBeGreaterThan(0);
    });

    it("non-quota write errors propagate (do not silently swallow)", () => {
      failNextSetItemTimes(99, "other");
      expect(() => saveSideboardPlan(saveInput({ name: "Boom" }))).toThrow(
        /boom/,
      );
    });

    it("on quota, the previous store is preserved (no silent data loss)", () => {
      const prior = saveSideboardPlan(saveInput({ name: "Prior" }));
      if (!prior.success) throw new Error("expected prior save success");

      // Now fail all subsequent writes so the next save cannot persist
      failNextSetItemTimes(99, "quota");
      const result = saveSideboardPlan(saveInput({ name: "Will Fail" }));
      expect(result.success).toBe(false);

      // The pre-existing plan must still be there
      const all = getAllSideboardPlans();
      expect(all.map((p) => p.name)).toEqual(["Prior"]);
    });
  });

  describe("updateSideboardPlan", () => {
    it('returns {success:false, error:"quota"} on quota', () => {
      const saved = saveSideboardPlan(saveInput({ name: "Will Update" }));
      if (!saved.success) throw new Error("expected save success");

      failNextSetItemTimes(99, "quota");
      const result = updateSideboardPlan(saved.plan.id, { name: "Updated" });
      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure");
      expect(result.error).toBe("quota");

      // original plan unchanged on disk
      const reread = getSideboardPlanById(saved.plan.id);
      expect(reread?.name).toBe("Will Update");
    });

    it('returns {success:false, error:"not-found"} for unknown ids', () => {
      // No quota override needed — update returns not-found before any write.
      const result = updateSideboardPlan("nope", { name: "Updated" });
      expect(result.success).toBe(false);
      if (result.success) throw new Error("expected failure");
      expect(result.error).toBe("not-found");
    });
  });

  describe("deleteSideboardPlan", () => {
    it("returns false (does not throw) on an unexpected quota error", () => {
      const saved = saveSideboardPlan(saveInput({ name: "Stays" }));
      if (!saved.success) throw new Error("expected save success");

      failNextSetItemTimes(99, "quota");
      // Should not throw, should not falsely report success
      const result = deleteSideboardPlan(saved.plan.id);
      expect(result).toBe(false);

      // Plan should still be there
      expect(getSideboardPlanById(saved.plan.id)).not.toBeNull();
    });
  });
});

// ----------------------------------------------------------------------------
// end of file
// ----------------------------------------------------------------------------
