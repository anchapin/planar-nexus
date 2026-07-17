/**
 * @fileoverview Replay sharing tests (issue #1432).
 *
 * Pins the real encode/decode behavior of `src/lib/replay-sharing.ts`:
 *   1. Round-trip is intentionally LOSSY — `minifyReplay` collapses each
 *      action's `resultingState` to counts and `expandGameState` rebuilds a
 *      simplified placeholder state. We assert deep equality on every field
 *      that IS preserved, and separately assert the reconstructed state is a
 *      well-formed GameState.
 *   2. Version/Phase coercion — `expandGameState` does
 *      `(minified.t?.cp || Phase.UNTAP) as Phase` with NO enum validation
 *      (QA report §2.8). We pin that unknown strings pass through verbatim
 *      and that a missing phase defaults to UNTAP.
 *   3. Adversarial JSON — `decodeReplayFromURL` catches every error path and
 *      returns null; we feed it malformed base64, malformed JSON, null,
 *      wrong-shape objects and prototype-pollution-ish keys.
 *
 * `fetch`, `navigator.clipboard` and `URL.createObjectURL` are mocked per
 * test because jsdom does not implement them.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import type {
  GameState,
  Player,
  Zone,
  Combat,
  LinkedEffectRegistry,
} from "../game-state/types";
import { Phase, ZoneType } from "../game-state/types";
import { ReplacementEffectManager } from "../game-state/replacement-effects";
import { LayerSystem } from "../game-state/layer-system";
import type { Replay } from "../game-state/replay";
import {
  encodeReplayToURL,
  decodeReplayFromURL,
  generateShareableURL,
  generateServerShareableLink,
  getReplayFromCurrentURL,
  copyShareableLink,
  exportReplayToFile,
  importReplayFromFile,
  importReplayFromURL,
  canShareViaURL,
  getEstimatedURLLength,
} from "../replay-sharing";

const FIXED_NOW = 1_700_000_000_000;

/** Build a minimal-but-valid GameState mirroring expandGameState's output. */
function makeGameState(): GameState {
  const playerId = "p1";
  return {
    gameId: "g1",
    players: new Map<string, Player>([
      [
        playerId,
        {
          id: playerId,
          name: "Alex",
          life: 20,
        } as Player,
      ],
    ]),
    cards: new Map(),
    zones: new Map<string, Zone>([
      [
        `hand-${playerId}`,
        {
          type: ZoneType.HAND,
          playerId,
          cardIds: ["c1", "c2"],
          isRevealed: false,
          visibleTo: [playerId],
        } as Zone,
      ],
      [
        "battlefield",
        {
          type: ZoneType.BATTLEFIELD,
          playerId: null,
          cardIds: ["c3", "c4"],
          isRevealed: true,
          visibleTo: [],
        } as Zone,
      ],
      [
        `library-${playerId}`,
        {
          type: ZoneType.LIBRARY,
          playerId,
          cardIds: Array(40).fill("x"),
          isRevealed: false,
          visibleTo: [playerId],
        } as Zone,
      ],
      [
        `graveyard-${playerId}`,
        {
          type: ZoneType.GRAVEYARD,
          playerId,
          cardIds: [],
          isRevealed: true,
          visibleTo: [],
        } as Zone,
      ],
    ]),
    stack: [],
    turn: {
      activePlayerId: playerId,
      currentPhase: Phase.PRECOMBAT_MAIN,
      turnNumber: 3,
      extraTurns: 0,
      isFirstTurn: false,
      startedAt: FIXED_NOW,
    },
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    } as Combat,
    waitingChoice: null,
    priorityPlayerId: playerId,
    consecutivePasses: 0,
    status: "in_progress",
    winners: [],
    endReason: null,
    format: "modern",
    createdAt: FIXED_NOW,
    lastModifiedAt: FIXED_NOW,
    replacementEffectManager: new ReplacementEffectManager(),
    layerSystem: new LayerSystem(),
    linkedEffectRegistry: {
      effects: [],
      bySourceCard: new Map(),
    } as LinkedEffectRegistry,
  };
}

function makeReplay(overrides: Partial<Replay> = {}): Replay {
  return {
    id: "replay-1",
    metadata: {
      format: "modern",
      playerNames: ["Alex", "Sam"],
      startingLife: 20,
      isCommander: false,
      winners: ["Alex"],
      gameStartDate: FIXED_NOW,
      gameEndDate: FIXED_NOW + 1000,
      endReason: "concession",
    },
    actions: [
      {
        sequenceNumber: 0,
        action: {
          type: "cast_spell",
          playerId: "p1",
          timestamp: FIXED_NOW,
          data: { cardId: "c1" },
        },
        resultingState: makeGameState(),
        description: "Alex cast Lightning Bolt",
        recordedAt: FIXED_NOW,
      },
    ],
    currentPosition: 0,
    totalActions: 1,
    createdAt: FIXED_NOW,
    lastModifiedAt: FIXED_NOW,
    ...overrides,
  };
}

/** Encode a raw JS value the same way encodeReplayToURL does. */
function encodeValue(value: unknown): string {
  return btoa(encodeURIComponent(JSON.stringify(value)));
}

describe("replay-sharing", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // 1. Round-trip (lossy)
  // -------------------------------------------------------------------
  describe("encode/decode round-trip", () => {
    it("preserves id, metadata and top-level scalar fields", () => {
      const replay = makeReplay();
      const encoded = encodeReplayToURL(replay);
      const decoded = decodeReplayFromURL(encoded)!;

      expect(decoded.id).toBe(replay.id);
      expect(decoded.metadata).toEqual(replay.metadata);
      expect(decoded.currentPosition).toBe(replay.currentPosition);
      expect(decoded.totalActions).toBe(replay.totalActions);
      expect(decoded.createdAt).toBe(replay.createdAt);
      expect(decoded.lastModifiedAt).toBe(replay.lastModifiedAt);
    });

    it("preserves per-action type/playerId/data/description/timestamps", () => {
      const replay = makeReplay();
      const decoded = decodeReplayFromURL(encodeReplayToURL(replay))!;

      expect(decoded.actions).toHaveLength(1);
      const a = decoded.actions[0];
      const r = replay.actions[0];
      expect(a.sequenceNumber).toBe(r.sequenceNumber);
      expect(a.action.type).toBe(r.action.type);
      expect(a.action.playerId).toBe(r.action.playerId);
      expect(a.action.data).toEqual(r.action.data);
      expect(a.action.timestamp).toBe(r.action.timestamp);
      expect(a.description).toBe(r.description);
      expect(a.recordedAt).toBe(r.recordedAt);
    });

    it("reconstructs a well-formed resultingState (lossy but valid)", () => {
      const decoded = decodeReplayFromURL(encodeReplayToURL(makeReplay()))!;
      const state = decoded.actions[0].resultingState;

      // Players and zones survive as Maps with the right cardinalities.
      expect(state.players).toBeInstanceOf(Map);
      expect(state.players.size).toBe(1);
      expect(state.zones).toBeInstanceOf(Map);
      expect(state.zones.size).toBeGreaterThan(0);
      // Battlefield count (2 cards) is preserved as placeholder ids.
      const bf = state.zones.get("battlefield");
      expect(bf?.cardIds).toHaveLength(2);
      // Hand size for the single player is preserved.
      const hand = state.zones.get("hand-p1");
      expect(hand?.cardIds).toHaveLength(2);
      // Manager instances are present (not undefined).
      expect(state.replacementEffectManager).toBeDefined();
      expect(state.layerSystem).toBeDefined();
    });

    it("round-trips a multi-action replay with no winners/end", () => {
      const base = makeReplay();
      const replay = makeReplay({
        id: "replay-2",
        metadata: {
          format: "commander",
          playerNames: ["A", "B", "C", "D"],
          startingLife: 40,
          isCommander: true,
          gameStartDate: FIXED_NOW,
        },
        actions: [
          base.actions[0],
          {
            ...base.actions[0],
            sequenceNumber: 1,
            action: {
              type: "pass_priority",
              playerId: "p2",
              timestamp: FIXED_NOW + 5,
              data: {},
            },
            description: "Sam passed",
          },
        ],
        totalActions: 2,
        currentPosition: 1,
      });

      const decoded = decodeReplayFromURL(encodeReplayToURL(replay))!;
      expect(decoded.actions).toHaveLength(2);
      expect(decoded.metadata.isCommander).toBe(true);
      expect(decoded.metadata.startingLife).toBe(40);
      expect(decoded.metadata.winners).toBeUndefined();
      expect(decoded.metadata.gameEndDate).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // 2. Version / Phase coercion  (pins QA-2.8)
  // -------------------------------------------------------------------
  describe("Phase / status coercion (no enum validation — pins QA-2.8)", () => {
    it("passes an unknown phase string through verbatim (silent cast)", () => {
      const minified = {
        i: "r",
        m: {
          f: "modern",
          p: ["A"],
          s: 20,
          c: false,
        },
        a: [
          {
            s: 0,
            t: "cast_spell",
            pid: "p1",
            rs: {
              t: { cp: "NOT_A_REAL_PHASE", tn: 5 },
              p: [{ id: "p1", n: "A", l: 17, h: 3 }],
              z: { bf: 1, g: 0, l: 30 },
            },
            desc: "x",
            ra: FIXED_NOW,
          },
        ],
        cp: 0,
        ta: 1,
        ca: FIXED_NOW,
        lma: FIXED_NOW,
      };

      const decoded = decodeReplayFromURL(encodeValue(minified))!;
      expect(decoded.actions[0].resultingState.turn.currentPhase).toBe(
        "NOT_A_REAL_PHASE",
      );
    });

    it("defaults a missing phase to UNTAP", () => {
      const minified = {
        i: "r",
        m: { f: "modern", p: ["A"], s: 20, c: false },
        a: [
          {
            s: 0,
            t: "cast_spell",
            pid: "p1",
            rs: {
              t: { tn: 2 }, // no cp
              p: [{ id: "p1", n: "A", l: 20, h: 7 }],
              z: { bf: 0, g: 0, l: 40 },
            },
            desc: "x",
            ra: FIXED_NOW,
          },
        ],
        cp: 0,
        ta: 1,
        ca: FIXED_NOW,
        lma: FIXED_NOW,
      };

      const decoded = decodeReplayFromURL(encodeValue(minified))!;
      expect(decoded.actions[0].resultingState.turn.currentPhase).toBe(
        Phase.UNTAP,
      );
    });

    it("passes an unknown status string through verbatim", () => {
      const minified = {
        i: "r",
        m: { f: "modern", p: ["A"], s: 20, c: false },
        a: [
          {
            s: 0,
            t: "cast_spell",
            pid: "p1",
            rs: {
              p: [{ id: "p1", n: "A", l: 20, h: 7 }],
              z: { bf: 0, g: 0, l: 40 },
              s: "frozen", // not a real GameStatus
            },
            desc: "x",
            ra: FIXED_NOW,
          },
        ],
        cp: 0,
        ta: 1,
        ca: FIXED_NOW,
        lma: FIXED_NOW,
      };

      const decoded = decodeReplayFromURL(encodeValue(minified))!;
      expect(decoded.actions[0].resultingState.status).toBe("frozen");
    });
  });

  // -------------------------------------------------------------------
  // 3. Adversarial JSON
  // -------------------------------------------------------------------
  describe("adversarial decodeReplayFromURL (fails safe → null)", () => {
    it("returns null for malformed base64", () => {
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      expect(decodeReplayFromURL("!!!not-base64!!!")).toBeNull();
      expect(errSpy).toHaveBeenCalled();
    });

    it("returns null when the decoded payload is not valid JSON", () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      // btoa("not json") decodes to a non-JSON string.
      expect(decodeReplayFromURL(btoa("not json at all"))).toBeNull();
    });

    it("returns null for an empty string", () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      expect(decodeReplayFromURL("")).toBeNull();
    });

    it("returns null when the payload is JSON null", () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      expect(decodeReplayFromURL(encodeValue(null))).toBeNull();
    });

    it("returns null when required fields are missing (empty object)", () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      // expandReplay touches minified.a.map → throws on undefined.
      expect(decodeReplayFromURL(encodeValue({}))).toBeNull();
    });

    it("does not pollute Object.prototype via a __proto__ key", () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      const payload = { __proto__: { polluted: "yes" } };
      // Decoding throws (wrong shape) → returns null; prototype stays clean.
      expect(decodeReplayFromURL(encodeValue(payload))).toBeNull();
      expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    });
  });

  describe("encodeReplayToURL failure", () => {
    it("re-throws a descriptive error when minify/encode fails", () => {
      // A circular reference inside action.data is copied verbatim into the
      // minified envelope, so JSON.stringify then throws inside encode.
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const bad = makeReplay();
      bad.actions[0].action.data = circular as never;
      jest.spyOn(console, "error").mockImplementation(() => {});

      expect(() => encodeReplayToURL(bad)).toThrow(
        "Failed to encode replay for sharing",
      );
    });
  });

  // -------------------------------------------------------------------
  // 4. URL length guards
  // -------------------------------------------------------------------
  describe("URL length guards", () => {
    it("generateShareableURL returns a replay URL for a small replay", () => {
      const url = generateShareableURL(makeReplay())!;
      expect(url).toContain("/replay?replay=");
      expect(url.startsWith("http") || url.startsWith("localhost")).toBe(true);
    });

    it("generateShareableURL returns null when the replay exceeds 8000 chars", () => {
      const huge = makeReplay({
        actions: Array.from({ length: 400 }, (_, i) => ({
          sequenceNumber: i,
          action: {
            type: "cast_spell",
            playerId: "p1",
            timestamp: FIXED_NOW + i,
            data: { cardId: `c${i}`, padding: "x".repeat(40) },
          },
          resultingState: makeGameState(),
          description: `action ${i} `.repeat(20),
          recordedAt: FIXED_NOW + i,
        })),
        totalActions: 400,
      });
      jest.spyOn(console, "warn").mockImplementation(() => {});
      expect(generateShareableURL(huge)).toBeNull();
    });

    it("canShareViaURL mirrors the length guard", () => {
      expect(canShareViaURL(makeReplay())).toBe(true);
    });

    it("getEstimatedURLLength is positive for a shareable replay", () => {
      expect(getEstimatedURLLength(makeReplay())).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------
  // 5. Current-URL extraction
  // -------------------------------------------------------------------
  describe("getReplayFromCurrentURL", () => {
    it("returns null when the URL has no replay param", () => {
      expect(getReplayFromCurrentURL()).toBeNull();
    });

    it("decodes the replay param when present", () => {
      const encoded = encodeReplayToURL(makeReplay());
      // jsdom supports history.replaceState for updating location.search.
      window.history.replaceState({}, "", `/replay?replay=${encoded}`);

      try {
        const replay = getReplayFromCurrentURL();
        expect(replay).not.toBeNull();
        expect(replay!.id).toBe("replay-1");
      } finally {
        window.history.replaceState({}, "", "/");
      }
    });
  });

  // -------------------------------------------------------------------
  // 6. File / server / clipboard I/O
  // -------------------------------------------------------------------
  describe("file import/export", () => {
    it("importReplayFromFile round-trips a JSON file", async () => {
      const replay = makeReplay();
      // jsdom's File does not implement .text(); stub it directly.
      const file = {
        text: async () => JSON.stringify(replay),
      } as unknown as File;
      const imported = await importReplayFromFile(file);
      expect(imported).not.toBeNull();
      expect(imported!.id).toBe(replay.id);
      expect(imported!.metadata).toEqual(replay.metadata);
    });

    it("importReplayFromFile returns null on malformed text", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      const file = { text: async () => "{ broken" } as unknown as File;
      expect(await importReplayFromFile(file)).toBeNull();
    });

    /** jsdom does not implement URL.createObjectURL/revokeObjectURL. */
    function installURLMocks(): {
      createObjectURL: ReturnType<typeof jest.fn>;
      revokeObjectURL: ReturnType<typeof jest.fn>;
      restore: () => void;
    } {
      const url = URL as unknown as {
        createObjectURL?: unknown;
        revokeObjectURL?: unknown;
      };
      const prevCreate = url.createObjectURL;
      const prevRevoke = url.revokeObjectURL;
      const createObjectURL = jest.fn().mockReturnValue("blob:fake");
      const revokeObjectURL = jest.fn();
      url.createObjectURL = createObjectURL;
      url.revokeObjectURL = revokeObjectURL;
      return {
        createObjectURL,
        revokeObjectURL,
        restore: () => {
          url.createObjectURL = prevCreate;
          url.revokeObjectURL = prevRevoke;
        },
      };
    }

    function captureAnchor(): {
      capture: () => HTMLAnchorElement | null;
      install: () => void;
      restore: () => void;
    } {
      const realCreate = document.createElement.bind(document);
      let captured: HTMLAnchorElement | null = null;
      return {
        install: () => {
          jest
            .spyOn(document, "createElement")
            .mockImplementation((tag: string) => {
              const el = realCreate(tag);
              if (tag.toLowerCase() === "a") {
                captured = el as HTMLAnchorElement;
                el.click = jest.fn(); // jsdom click() is otherwise a no-op
              }
              return el;
            });
        },
        capture: () => captured,
        restore: () => {
          // restored via jest.restoreAllMocks() in afterEach
        },
      };
    }

    it("exportReplayToFile triggers an anchor download with the filename", () => {
      const urlMocks = installURLMocks();
      const anchor = captureAnchor();
      anchor.install();
      try {
        exportReplayToFile(makeReplay(), "my-replay.json");
        expect(urlMocks.createObjectURL).toHaveBeenCalledTimes(1);
        expect(urlMocks.revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(anchor.capture()!.download).toBe("my-replay.json");
        expect(anchor.capture()!.href).toBe("blob:fake");
      } finally {
        urlMocks.restore();
      }
    });

    it("exportReplayToFile uses a default filename derived from replay id", () => {
      const urlMocks = installURLMocks();
      const anchor = captureAnchor();
      anchor.install();
      try {
        exportReplayToFile(makeReplay({ id: "abc-123" }));
        expect(anchor.capture()!.download).toBe("replay-abc-123.json");
      } finally {
        urlMocks.restore();
      }
    });
  });

  describe("server shareable link", () => {
    /** Install a fetch mock; the global Response from jest.setup lacks .ok/.json. */
    function installFetch(response: unknown): {
      mock: ReturnType<typeof jest.fn>;
      restore: () => void;
    } {
      const g = globalThis as { fetch?: unknown };
      const prev = g.fetch;
      const mock = jest
        .fn<(input: string, init?: unknown) => Promise<unknown>>()
        .mockResolvedValue(response);
      g.fetch = mock;
      return {
        mock,
        restore: () => {
          g.fetch = prev;
        },
      };
    }

    it("POSTs the replay and returns the share URL on success", async () => {
      const { mock, restore } = installFetch({
        ok: true,
        status: 201,
        json: async () => ({ id: "srv-1" }),
      });
      try {
        const url = await generateServerShareableLink(
          makeReplay(),
          "https://srv.example",
        );
        expect(url).toBe("https://srv.example/replay/srv-1");
        expect(mock).toHaveBeenCalledWith(
          "https://srv.example/api/replays",
          expect.objectContaining({ method: "POST" }),
        );
      } finally {
        restore();
      }
    });

    it("returns null when the server responds with an error", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      const { restore } = installFetch({ ok: false, status: 500 });
      try {
        expect(
          await generateServerShareableLink(
            makeReplay(),
            "https://srv.example",
          ),
        ).toBeNull();
      } finally {
        restore();
      }
    });

    it("importReplayFromURL GETs and returns the replay on success", async () => {
      const replay = makeReplay();
      const { restore } = installFetch({
        ok: true,
        status: 200,
        json: async () => replay,
      });
      try {
        const imported = await importReplayFromURL(
          "srv-1",
          "https://srv.example",
        );
        expect(imported).not.toBeNull();
        expect(imported!.id).toBe("replay-1");
      } finally {
        restore();
      }
    });

    it("importReplayFromURL returns null on a non-ok response", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      const { restore } = installFetch({ ok: false, status: 404 });
      try {
        expect(
          await importReplayFromURL("srv-1", "https://srv.example"),
        ).toBeNull();
      } finally {
        restore();
      }
    });
  });

  describe("copyShareableLink", () => {
    it("returns true and writes the URL when clipboard is available", async () => {
      const writeText = jest
        .fn<(text: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      const ok = await copyShareableLink(makeReplay());
      expect(ok).toBe(true);
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0][0]).toContain("/replay?replay=");
    });

    it("returns false when the replay cannot be shared", async () => {
      const huge = makeReplay({
        actions: Array.from({ length: 400 }, (_, i) => ({
          sequenceNumber: i,
          action: {
            type: "cast_spell",
            playerId: "p1",
            timestamp: FIXED_NOW + i,
            data: { cardId: `c${i}`, padding: "x".repeat(40) },
          },
          resultingState: makeGameState(),
          description: `action ${i} `.repeat(20),
          recordedAt: FIXED_NOW + i,
        })),
        totalActions: 400,
      });
      expect(await copyShareableLink(huge)).toBe(false);
    });
  });
});
