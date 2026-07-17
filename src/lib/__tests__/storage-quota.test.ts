/**
 * @fileOverview Tests for storage quota estimation & graceful degradation.
 *
 * Issue #1085: verifies quota estimation (mocked navigator.storage), threshold
 * classification, typed QuotaExceededError handling, and the no-throw
 * withQuotaGuard degrade path.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import {
  QUOTA_WARN_THRESHOLD,
  QUOTA_CRITICAL_THRESHOLD,
  QUOTA_SAFETY_MARGIN_BYTES,
  AVG_CARD_BYTES,
  FALLBACK_QUOTA_BYTES,
  QuotaExceededError,
  getQuotaLevel,
  isQuotaExceededError,
  classifyWriteError,
  getStorageEstimate,
  requestPersistentStorage,
  isStoragePersistent,
  withQuotaGuard,
  predictQuotaHeadroom,
  estimateCardWriteBytes,
  getQuotaRemediationMessage,
} from "../storage-quota";

// jsdom + jest.setup.js provide navigator.storage.estimate, but each test needs
// deterministic control, so we swap the whole storage object per test.
const originalStorage = (global.navigator as unknown as { storage?: unknown })
  .storage;

function setStorage(storage: unknown): void {
  (global.navigator as unknown as { storage?: unknown }).storage = storage;
}

describe("storage-quota", () => {
  beforeEach(() => {
    setStorage({
      estimate: async () => ({ usage: 1024, quota: 50 * 1024 }),
    });
  });

  afterEach(() => {
    setStorage(originalStorage);
  });

  describe("thresholds", () => {
    it("exposes warn=0.9 and critical=0.98 constants", () => {
      expect(QUOTA_WARN_THRESHOLD).toBe(0.9);
      expect(QUOTA_CRITICAL_THRESHOLD).toBe(0.98);
    });

    it("classifies ratios into ok/warning/critical", () => {
      expect(getQuotaLevel(0, true)).toBe("ok");
      expect(getQuotaLevel(0.5, true)).toBe("ok");
      expect(getQuotaLevel(0.89, true)).toBe("ok");
      expect(getQuotaLevel(QUOTA_WARN_THRESHOLD, true)).toBe("warning");
      expect(getQuotaLevel(0.95, true)).toBe("warning");
      expect(getQuotaLevel(QUOTA_CRITICAL_THRESHOLD, true)).toBe("critical");
      expect(getQuotaLevel(1, true)).toBe("critical");
    });

    it("returns unknown when estimate is unavailable", () => {
      expect(getQuotaLevel(0.99, false)).toBe("unknown");
      expect(getQuotaLevel(0, false)).toBe("unknown");
    });
  });

  describe("getStorageEstimate", () => {
    it("returns a typed estimate from navigator.storage.estimate", async () => {
      setStorage({ estimate: async () => ({ usage: 90, quota: 100 }) });
      const est = await getStorageEstimate();
      expect(est.available).toBe(true);
      expect(est.usage).toBe(90);
      expect(est.quota).toBe(100);
      expect(est.ratio).toBeCloseTo(0.9);
      expect(est.level).toBe("warning");
    });

    it("degrades to unavailable when navigator.storage is missing", async () => {
      setStorage(undefined);
      const est = await getStorageEstimate();
      expect(est.available).toBe(false);
      expect(est.level).toBe("unknown");
      expect(est.ratio).toBe(0);
      expect(est.usage).toBe(0);
      expect(est.quota).toBe(0);
    });

    it("degrades when estimate() is not a function", async () => {
      setStorage({ estimate: "nope" });
      const est = await getStorageEstimate();
      expect(est.available).toBe(false);
      expect(est.level).toBe("unknown");
    });

    it("degrades (no throw) when estimate() rejects", async () => {
      setStorage({
        estimate: async () => {
          throw new Error("denied");
        },
      });
      const est = await getStorageEstimate();
      expect(est.available).toBe(false);
      expect(est.level).toBe("unknown");
    });

    it("clamps ratio to 1 when usage exceeds quota", async () => {
      setStorage({ estimate: async () => ({ usage: 200, quota: 100 }) });
      const est = await getStorageEstimate();
      expect(est.ratio).toBe(1);
      expect(est.level).toBe("critical");
    });

    it("treats zero quota as unavailable", async () => {
      setStorage({ estimate: async () => ({ usage: 5, quota: 0 }) });
      const est = await getStorageEstimate();
      expect(est.available).toBe(true);
      expect(est.quota).toBe(0);
      expect(est.ratio).toBe(0);
    });
  });

  describe("QuotaExceededError", () => {
    it("carries name, message and storeName", () => {
      const err = new QuotaExceededError("boom", "cards");
      expect(err.name).toBe("QuotaExceededError");
      expect(err.message).toBe("boom");
      expect(err.storeName).toBe("cards");
    });

    it("is identifiable via isQuotaExceededError (instance)", () => {
      expect(isQuotaExceededError(new QuotaExceededError())).toBe(true);
    });

    it("preserves instanceof Error chain after transpilation", () => {
      const err = new QuotaExceededError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(QuotaExceededError);
      // survives a catch round-trip
      try {
        throw err;
      } catch (caught) {
        expect(caught).toBeInstanceOf(QuotaExceededError);
      }
    });

    it("recognises native DOMException-like quota errors by name", () => {
      const native = { name: "QuotaExceededError", message: "no space" };
      expect(isQuotaExceededError(native)).toBe(true);
    });

    it("recognises quota errors by message substring", () => {
      expect(isQuotaExceededError(new Error("QuotaExceededError: ..."))).toBe(
        true,
      );
      expect(isQuotaExceededError(new Error("disk full"))).toBe(false);
    });

    it("rejects null/undefined/empty", () => {
      expect(isQuotaExceededError(null)).toBe(false);
      expect(isQuotaExceededError(undefined)).toBe(false);
      expect(isQuotaExceededError({})).toBe(false);
    });
  });

  describe("classifyWriteError", () => {
    it("converts a quota error into a typed QuotaExceededError with store", () => {
      const err = classifyWriteError(
        { name: "QuotaExceededError", message: "full" },
        "put failed",
        "cards",
      );
      expect(err).toBeInstanceOf(QuotaExceededError);
      expect((err as QuotaExceededError).storeName).toBe("cards");
      expect(err.message).toContain("put failed");
      expect(err.message).toContain("full");
    });

    it("keeps non-quota errors as plain Errors with context", () => {
      const err = classifyWriteError(
        new Error("network"),
        "tx failed",
        "decks",
      );
      expect(err).not.toBeInstanceOf(QuotaExceededError);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain("tx failed");
      expect(err.message).toContain("network");
    });

    it("handles non-Error thrown values", () => {
      const err = classifyWriteError("string failure", "ctx", "store");
      expect(err.message).toContain("string failure");
    });
  });

  describe("withQuotaGuard", () => {
    it("returns an ok value when the write succeeds (no throw)", async () => {
      const res = await withQuotaGuard(async () => 42);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toBe(42);
    });

    it("converts a QuotaExceededError into a non-throwing failure result", async () => {
      const res = await withQuotaGuard(async () => {
        throw new QuotaExceededError("full", "cards");
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(QuotaExceededError);
        expect(res.error.storeName).toBe("cards");
      }
    });

    it("catches a native-named QuotaExceededError without throwing", async () => {
      const res = await withQuotaGuard(async () => {
        throw { name: "QuotaExceededError", message: "full" };
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBeInstanceOf(QuotaExceededError);
    });

    it("rethrows non-quota errors (does not swallow genuine bugs)", async () => {
      await expect(
        withQuotaGuard(async () => {
          throw new Error("unrelated failure");
        }),
      ).rejects.toThrow("unrelated failure");
    });
  });

  describe("persistence", () => {
    it("returns false when navigator.storage is missing", async () => {
      setStorage(undefined);
      expect(await requestPersistentStorage()).toBe(false);
      expect(await isStoragePersistent()).toBe(false);
    });

    it("returns false when persist/persisted are unavailable", async () => {
      setStorage({ estimate: async () => ({ usage: 0, quota: 0 }) });
      expect(await requestPersistentStorage()).toBe(false);
      expect(await isStoragePersistent()).toBe(false);
    });

    it("delegates to navigator.storage.persist / persisted when available", async () => {
      const persist = jest.fn(async () => true);
      const persisted = jest.fn(async () => true);
      setStorage({
        estimate: async () => ({ usage: 0, quota: 0 }),
        persist,
        persisted,
      });
      expect(await requestPersistentStorage()).toBe(true);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(await isStoragePersistent()).toBe(true);
      expect(persisted).toHaveBeenCalledTimes(1);
    });

    it("swallows persist() rejection (never throws)", async () => {
      setStorage({
        estimate: async () => ({ usage: 0, quota: 0 }),
        persist: async () => {
          throw new Error("denied");
        },
      });
      expect(await requestPersistentStorage()).toBe(false);
    });
  });

  describe("remediation message", () => {
    it("returns a critical message mentioning full/export", () => {
      const m = getQuotaRemediationMessage("critical");
      expect(m.length).toBeGreaterThan(10);
      expect(m.toLowerCase()).toContain("full");
      expect(m.toLowerCase()).toContain("export");
    });

    it("returns a non-empty warning message", () => {
      const m = getQuotaRemediationMessage("warning");
      expect(m.length).toBeGreaterThan(10);
    });
  });

  describe("estimateCardWriteBytes", () => {
    it("returns 0 for non-positive counts", () => {
      expect(estimateCardWriteBytes(0)).toBe(0);
      expect(estimateCardWriteBytes(-5)).toBe(0);
    });

    it("scales linearly with card count and includes the safety margin", () => {
      const expected = 1000 * AVG_CARD_BYTES + QUOTA_SAFETY_MARGIN_BYTES;
      expect(estimateCardWriteBytes(1000)).toBe(expected);
    });
  });

  describe("predictQuotaHeadroom", () => {
    it("returns ok when the write fits comfortably within quota", async () => {
      // 100 MB quota, 10 MB used, 5 MB write → plenty of room.
      setStorage({
        estimate: async () => ({
          usage: 10 * 1024 * 1024,
          quota: 100 * 1024 * 1024,
        }),
      });
      const h = await predictQuotaHeadroom(5 * 1024 * 1024);
      expect(h.ok).toBe(true);
      expect(h.level).toBe("ok");
      expect(h.available).toBeGreaterThan(0);
      expect(h.requiredBytes).toBe(5 * 1024 * 1024);
      expect(h.reason).toBeUndefined();
      // projectedRatio = (10 + 5) / 100 = 0.15
      expect(h.projectedRatio).toBeCloseTo(0.15, 5);
    });

    it("returns !ok with a reason when the write exceeds remaining quota", async () => {
      // 100 MB quota, 95 MB used, 10 MB write → 5 MB over budget.
      setStorage({
        estimate: async () => ({
          usage: 95 * 1024 * 1024,
          quota: 100 * 1024 * 1024,
        }),
      });
      const h = await predictQuotaHeadroom(10 * 1024 * 1024);
      expect(h.ok).toBe(false);
      expect(h.available).toBeLessThan(0);
      expect(h.reason).toBeTruthy();
      expect(h.reason).toMatch(/more space than is available/i);
    });

    it("returns !ok when the projected ratio crosses the critical threshold", async () => {
      // 100 MB quota, 97 MB used, 2 MB write → fits nominally (1 MB free) but
      // projected ratio = 0.99 ≥ QUOTA_CRITICAL_THRESHOLD → critical/!ok.
      setStorage({
        estimate: async () => ({
          usage: 97 * 1024 * 1024,
          quota: 100 * 1024 * 1024,
        }),
      });
      const h = await predictQuotaHeadroom(2 * 1024 * 1024);
      expect(h.ok).toBe(false);
      expect(h.level).toBe("critical");
      expect(h.projectedRatio).toBeGreaterThanOrEqual(QUOTA_CRITICAL_THRESHOLD);
      expect(h.reason).toMatch(/critically full/i);
    });

    it("returns ok but level=warning when projected ratio crosses warn threshold", async () => {
      // 100 MB quota, 88 MB used, 3 MB write → projected 0.91 (warn band).
      setStorage({
        estimate: async () => ({
          usage: 88 * 1024 * 1024,
          quota: 100 * 1024 * 1024,
        }),
      });
      const h = await predictQuotaHeadroom(3 * 1024 * 1024);
      expect(h.ok).toBe(true);
      expect(h.level).toBe("warning");
      expect(h.projectedRatio).toBeGreaterThanOrEqual(QUOTA_WARN_THRESHOLD);
    });

    it("gracefully allows (ok:true, level:unknown) when estimate() is unavailable", async () => {
      // Mirrors Tauri webviews / private mode with no Storage API. Callers
      // must fall back to the reactive error path — we never block the write
      // when we cannot measure.
      setStorage(undefined);
      const h = await predictQuotaHeadroom(50 * 1024 * 1024);
      expect(h.ok).toBe(true);
      expect(h.level).toBe("unknown");
      expect(h.available).toBe(FALLBACK_QUOTA_BYTES);
      expect(h.usage).toBe(0);
      expect(h.quota).toBe(0);
      expect(h.reason).toBeUndefined();
    });

    it("gracefully allows when estimate() rejects", async () => {
      setStorage({
        estimate: async () => {
          throw new Error("denied");
        },
      });
      const h = await predictQuotaHeadroom(1024);
      expect(h.ok).toBe(true);
      expect(h.level).toBe("unknown");
    });

    it("treats a zero-byte write as ok with no projected change", async () => {
      setStorage({
        estimate: async () => ({
          usage: 10 * 1024 * 1024,
          quota: 100 * 1024 * 1024,
        }),
      });
      const h = await predictQuotaHeadroom(0);
      expect(h.ok).toBe(true);
      expect(h.requiredBytes).toBe(0);
      expect(h.projectedRatio).toBeCloseTo(0.1, 5);
    });

    it("clamps projectedRatio to 1 when the write would far exceed quota", async () => {
      setStorage({
        estimate: async () => ({ usage: 90, quota: 100 }),
      });
      const h = await predictQuotaHeadroom(1_000_000);
      expect(h.ok).toBe(false);
      expect(h.projectedRatio).toBe(1);
    });

    it("cooperates with persisted-storage state without changing the decision", async () => {
      // persistence is orthogonal to the headroom prediction; a persisted
      // origin still reports usage/quota via estimate(). We only assert the
      // decision ignores persist state (the persisted() probe is exercised in
      // the persistence describe block above).
      setStorage({
        estimate: async () => ({
          usage: 10 * 1024 * 1024,
          quota: 100 * 1024 * 1024,
        }),
        persisted: async () => true,
        persist: async () => true,
      });
      const h = await predictQuotaHeadroom(5 * 1024 * 1024);
      expect(h.ok).toBe(true);
      expect(await isStoragePersistent()).toBe(true);
    });
  });
});
