/**
 * @fileoverview Unit tests for the engine-free replay share-link module.
 *
 * Issue #2978: the #2947 diff moved the *encode* half of
 * `src/lib/replay-sharing.ts` into the new leaf module
 * `src/lib/replay-share-link.ts` (so the /saved-games route can build a
 * share link without dragging the rules engine into its module graph).
 * The sibling suite `replay-sharing.test.ts` exercises the same functions
 * through the `replay-sharing.ts` re-export; this suite targets the new
 * module directly and pins the paths that were left uncovered by that
 * refactor:
 *
 *   1. The minified payload shape (counts, hand sizes, turn metadata) —
 *      i.e. what the decoder on the other side actually receives.
 *   2. The v2 delta-encoded fallback: an action WITHOUT `resultingState`
 *      must be reconstructed through `getStateAtPosition` before it is
 *      minified (issue #1574 delta replays).
 *   3. Every defensive branch: encoding failures (circular payloads),
 *      over-long URLs, a missing `window`, a missing clipboard, server
 *      errors and malformed files.
 *
 * No production code is touched by this suite.
 */

import { describe, it, expect, jest, afterEach } from "@jest/globals";
import type { GameState, Player, Zone } from "../game-state/types";
import { Phase, ZoneType } from "../game-state/types";
import type { Replay } from "../game-state/replay";
import {
  encodeReplayToURL,
  generateShareableURL,
  generateServerShareableLink,
  copyShareableLink,
  exportReplayToFile,
  importReplayFromFile,
  importReplayFromURL,
  canShareViaURL,
  getEstimatedURLLength,
} from "../replay-share-link";

const FIXED_NOW = 1_700_000_000_000;

/**
 * Build a structurally valid GameState (the shape `cloneGameState` and the
 * minifier both expect): Maps for players/zones/cards, an array stack and
 * a turn/combat object.
 */
function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const p1 = { id: "p1", name: "Alex", life: 20 } as Player;
  const zones = new Map<string, Zone>([
    [
      "hand-p1",
      {
        type: ZoneType.HAND,
        playerId: "p1",
        cardIds: ["c1", "c2"],
        isRevealed: false,
        visibleTo: ["p1"],
      } as Zone,
    ],
    [
      "battlefield",
      {
        type: ZoneType.BATTLEFIELD,
        playerId: null,
        cardIds: ["c3", "c4", "c5"],
        isRevealed: true,
        visibleTo: [],
      } as Zone,
    ],
    [
      "graveyard-p1",
      {
        type: ZoneType.GRAVEYARD,
        playerId: "p1",
        cardIds: ["c6"],
        isRevealed: true,
        visibleTo: [],
      } as Zone,
    ],
    [
      "library-p1",
      {
        type: ZoneType.LIBRARY,
        playerId: "p1",
        cardIds: Array(40).fill("x"),
        isRevealed: false,
        visibleTo: ["p1"],
      } as Zone,
    ],
  ]);

  const state = {
    gameId: "g1",
    players: new Map<string, Player>([["p1", p1]]),
    cards: new Map(),
    zones,
    stack: [],
    turn: {
      activePlayerId: "p1",
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
    },
    waitingChoice: null,
    priorityPlayerId: "p1",
    consecutivePasses: 0,
    status: "in_progress",
    winners: [],
    endReason: null,
    format: "modern",
    createdAt: FIXED_NOW,
    lastModifiedAt: FIXED_NOW,
    ...overrides,
  } as unknown as GameState;

  return state;
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
  } as Replay;
}

/** Decode the base64 payload produced by `encodeReplayToURL`. */
function decodeMinified(encoded: string): any {
  return JSON.parse(decodeURIComponent(atob(encoded)));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("replay-share-link", () => {
  describe("minified payload shape", () => {
    it("carries the id, metadata and top-level counters", () => {
      const minified = decodeMinified(encodeReplayToURL(makeReplay()));

      expect(minified.i).toBe("replay-1");
      expect(minified.m.f).toBe("modern");
      expect(minified.m.p).toEqual(["Alex", "Sam"]);
      expect(minified.m.s).toBe(20);
      expect(minified.m.c).toBe(false);
      expect(minified.m.w).toEqual(["Alex"]);
      expect(minified.m.sd).toBe(FIXED_NOW);
      expect(minified.m.ed).toBe(FIXED_NOW + 1000);
      expect(minified.m.er).toBe("concession");
      expect(minified.cp).toBe(0);
      expect(minified.ta).toBe(1);
      expect(minified.ca).toBe(FIXED_NOW);
      expect(minified.lma).toBe(FIXED_NOW);
    });

    it("omits winners / end reason when the metadata does not carry them", () => {
      const replay = makeReplay();
      delete (replay.metadata as { winners?: string[] }).winners;
      delete (replay.metadata as { endReason?: string }).endReason;

      const minified = decodeMinified(encodeReplayToURL(replay));

      expect(minified.m.w).toBeUndefined();
      expect(minified.m.er).toBeUndefined();
    });

    it("counts battlefield / graveyard / library cards and hand sizes", () => {
      const minified = decodeMinified(encodeReplayToURL(makeReplay()));
      const rs = minified.a[0].rs;

      expect(rs.z).toEqual({ bf: 3, g: 1, l: 40 });
      expect(rs.p).toEqual([{ id: "p1", n: "Alex", l: 20, h: 2 }]);
      expect(rs.t).toEqual({
        tn: 3,
        cp: Phase.PRECOMBAT_MAIN,
        ap: "p1",
        pp: "p1",
      });
      expect(rs.s).toBe("in_progress");
      expect(rs.w).toEqual([]);
      expect(rs.er).toBeUndefined();
    });

    it("ignores hand zones that carry no playerId and players without a hand", () => {
      const state = makeGameState();
      // A hand zone with no owner must not be attributed to anybody.
      state.zones.set(
        "hand-orphan",
        {
          type: ZoneType.HAND,
          playerId: null,
          cardIds: ["c9"],
          isRevealed: false,
          visibleTo: [],
        } as unknown as Zone,
      );
      // A player with no hand zone at all falls back to a hand size of 0.
      state.players.set("p2", { id: "p2", name: "Sam", life: 20 } as Player);

      const replay = makeReplay({
        actions: [
          {
            sequenceNumber: 0,
            action: {
              type: "pass_priority",
              playerId: "p1",
              timestamp: FIXED_NOW,
              data: {},
            },
            resultingState: state,
            description: "pass",
            recordedAt: FIXED_NOW,
          },
        ],
      } as unknown as Partial<Replay>);

      const minified = decodeMinified(encodeReplayToURL(replay));
      const p = minified.a[0].rs.p;

      expect(p).toHaveLength(2);
      expect(p.find((x: any) => x.id === "p1").h).toBe(2);
      expect(p.find((x: any) => x.id === "p2").h).toBe(0);
    });

    it("keeps the status / winners / end reason of a finished game", () => {
      const state = makeGameState({
        status: "completed",
        winners: ["p1"],
        endReason: "deck_out",
        priorityPlayerId: null,
      });
      const replay = makeReplay({
        actions: [
          {
            sequenceNumber: 0,
            action: {
              type: "concede",
              playerId: "p2",
              timestamp: FIXED_NOW,
              data: {},
            },
            resultingState: state,
            description: "Sam conceded",
            recordedAt: FIXED_NOW,
          },
        ],
      } as unknown as Partial<Replay>);

      const rs = decodeMinified(encodeReplayToURL(replay)).a[0].rs;

      expect(rs.s).toBe("completed");
      expect(rs.w).toEqual(["p1"]);
      expect(rs.er).toBe("deck_out");
      expect(rs.t.pp).toBeUndefined();
    });

    it("tolerates a state without a turn and without players", () => {
      const state = makeGameState();
      (state as unknown as { turn?: unknown }).turn = undefined;
      (state as unknown as { players?: unknown }).players = undefined;

      const replay = makeReplay({
        actions: [
          {
            sequenceNumber: 0,
            action: {
              type: "cast_spell",
              playerId: "p1",
              timestamp: FIXED_NOW,
              data: {},
            },
            resultingState: state,
            description: "cast",
            recordedAt: FIXED_NOW,
          },
        ],
      } as unknown as Partial<Replay>);

      const rs = decodeMinified(encodeReplayToURL(replay)).a[0].rs;

      expect(rs.t).toEqual({
        tn: undefined,
        cp: undefined,
        ap: undefined,
        pp: "p1",
      });
      expect(rs.p).toEqual([]);
    });

    it("minifies the action envelope (sequence, type, player, data, timestamps)", () => {
      const minified = decodeMinified(encodeReplayToURL(makeReplay()));
      const a = minified.a[0];

      expect(a.s).toBe(0);
      expect(a.t).toBe("cast_spell");
      expect(a.pid).toBe("p1");
      expect(a.d).toEqual({ cardId: "c1" });
      expect(a.desc).toBe("Alex cast Lightning Bolt");
      expect(a.ra).toBe(FIXED_NOW);
    });
  });

  describe("delta-encoded (v2) replays", () => {
    it("reconstructs a missing resultingState via getStateAtPosition", () => {
      const snapshotState = makeGameState();
      const replay = makeReplay({
        schemaVersion: 2,
        snapshots: [
          {
            sequenceNumber: 0,
            state: snapshotState,
            stateHash: "hash-0",
          },
        ],
        actions: [
          {
            sequenceNumber: 0,
            action: {
              type: "cast_spell",
              playerId: "p1",
              timestamp: FIXED_NOW,
              data: { cardId: "c1" },
            },
            // No `resultingState` — the minifier must rebuild it.
            delta: { fields: { consecutivePasses: 1 } },
            description: "Alex cast Lightning Bolt",
            recordedAt: FIXED_NOW,
          },
        ],
      } as unknown as Partial<Replay>);

      const minified = decodeMinified(encodeReplayToURL(replay));
      const rs = minified.a[0].rs;

      expect(rs.p).toEqual([{ id: "p1", n: "Alex", l: 20, h: 2 }]);
      expect(rs.z).toEqual({ bf: 3, g: 1, l: 40 });
      expect(rs.t.tn).toBe(3);
    });

    it("reconstructs the state of a later delta action from the snapshot anchor", () => {
      const snapshotState = makeGameState();
      const replay = makeReplay({
        schemaVersion: 2,
        snapshots: [
          {
            sequenceNumber: 0,
            state: snapshotState,
            stateHash: "hash-0",
          },
        ],
        actions: [
          {
            sequenceNumber: 0,
            action: {
              type: "cast_spell",
              playerId: "p1",
              timestamp: FIXED_NOW,
              data: {},
            },
            delta: { fields: { consecutivePasses: 1 } },
            description: "cast",
            recordedAt: FIXED_NOW,
          },
          {
            sequenceNumber: 1,
            action: {
              type: "pass_priority",
              playerId: "p2",
              timestamp: FIXED_NOW + 1,
              data: {},
            },
            delta: {
              fields: { status: "completed", winners: ["p1"] },
              players: [["p2", undefined]],
            },
            description: "pass",
            recordedAt: FIXED_NOW + 1,
          },
        ],
        totalActions: 2,
        currentPosition: 1,
      } as unknown as Partial<Replay>);

      const minified = decodeMinified(encodeReplayToURL(replay));

      expect(minified.a).toHaveLength(2);
      expect(minified.a[1].rs.s).toBe("completed");
      expect(minified.a[1].rs.w).toEqual(["p1"]);
      // The deleted player is gone from the reconstructed state.
      expect(
        minified.a[1].rs.p.find((x: any) => x.id === "p2"),
      ).toBeUndefined();
    });
  });

  describe("encodeReplayToURL", () => {
    it("throws a stable error when the payload cannot be serialised", () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const replay = makeReplay();
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      (replay.actions[0].action as { data: unknown }).data = circular;

      expect(() => encodeReplayToURL(replay)).toThrow(
        "Failed to encode replay for sharing",
      );
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("generateShareableURL", () => {
    it("builds a /replay URL with the replay query parameter", () => {
      const url = generateShareableURL(makeReplay());
      expect(url).not.toBeNull();
      expect(url!.startsWith(`${window.location.origin}/replay?replay=`)).toBe(
        true,
      );
    });

    it("returns null when the encoded payload is too long", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const base = makeReplay();
      const huge = makeReplay({
        actions: Array.from({ length: 400 }, (_, i) => ({
          sequenceNumber: i,
          action: {
            type: "cast_spell",
            playerId: "p1",
            timestamp: FIXED_NOW + i,
            data: { cardId: `c${i}`, padding: "x".repeat(40) },
          },
          resultingState: base.actions[0].resultingState,
          description: `action ${i} `.repeat(20),
          recordedAt: FIXED_NOW + i,
        })),
        totalActions: 400,
      } as unknown as Partial<Replay>);

      expect(generateShareableURL(huge)).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("returns null when the replay cannot be encoded", () => {
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const replay = makeReplay();
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      (replay.actions[0].action as { data: unknown }).data = circular;

      expect(generateShareableURL(replay)).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("generateServerShareableLink", () => {
    const g = globalThis as { fetch?: unknown };

    afterEach(() => {
      delete g.fetch;
    });

    it("POSTs the replay and returns the server URL on success", async () => {
      const fetchMock = jest
        .fn<(input: string, init?: unknown) => Promise<unknown>>()
        .mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => ({ id: "srv-1" }),
        });
      g.fetch = fetchMock;

      const url = await generateServerShareableLink(
        makeReplay(),
        "https://srv.example",
      );

      expect(url).toBe("https://srv.example/replay/srv-1");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://srv.example/api/replays",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("returns null when the server responds with an error status", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      g.fetch = jest
        .fn<(input: string, init?: unknown) => Promise<unknown>>()
        .mockResolvedValue({ ok: false, status: 500 });

      expect(
        await generateServerShareableLink(
          makeReplay(),
          "https://srv.example",
        ),
      ).toBeNull();
    });

    it("returns null when the request itself fails", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      g.fetch = jest
        .fn<(input: string, init?: unknown) => Promise<unknown>>()
        .mockRejectedValue(new Error("offline"));

      expect(
        await generateServerShareableLink(
          makeReplay(),
          "https://srv.example",
        ),
      ).toBeNull();
    });
  });

  describe("copyShareableLink", () => {
    function installClipboard(writeText: unknown): () => void {
      const prev = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      return () => {
        if (prev) {
          Object.defineProperty(navigator, "clipboard", prev);
        } else {
          delete (navigator as { clipboard?: unknown }).clipboard;
        }
      };
    }

    it("writes the share URL to the clipboard and returns true", async () => {
      const writeText = jest
        .fn<(text: string) => Promise<void>>()
        .mockResolvedValue(undefined);
      const restore = installClipboard(writeText);
      try {
        expect(await copyShareableLink(makeReplay())).toBe(true);
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText.mock.calls[0][0]).toContain("/replay?replay=");
      } finally {
        restore();
      }
    });

    it("returns false when the clipboard write rejects", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      const writeText = jest
        .fn<(text: string) => Promise<void>>()
        .mockRejectedValue(new Error("denied"));
      const restore = installClipboard(writeText);
      try {
        expect(await copyShareableLink(makeReplay())).toBe(false);
      } finally {
        restore();
      }
    });

    it("returns false when there is no clipboard at all", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      const restore = installClipboard(undefined);
      try {
        expect(await copyShareableLink(makeReplay())).toBe(false);
      } finally {
        restore();
      }
    });

    it("returns false without touching the clipboard when no URL can be built", async () => {
      const writeText = jest.fn<(text: string) => Promise<void>>();
      const restore = installClipboard(writeText);
      jest.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const base = makeReplay();
        const huge = makeReplay({
          actions: Array.from({ length: 400 }, (_, i) => ({
            sequenceNumber: i,
            action: {
              type: "cast_spell",
              playerId: "p1",
              timestamp: FIXED_NOW + i,
              data: { cardId: `c${i}`, padding: "x".repeat(40) },
            },
            resultingState: base.actions[0].resultingState,
            description: `action ${i} `.repeat(20),
            recordedAt: FIXED_NOW + i,
          })),
          totalActions: 400,
        } as unknown as Partial<Replay>);

        expect(await copyShareableLink(huge)).toBe(false);
        expect(writeText).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  });

  describe("exportReplayToFile", () => {
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
                el.click = jest.fn();
              }
              return el;
            });
        },
        capture: () => captured,
      };
    }

    it("uses the provided filename and revokes the object URL", () => {
      const urlMocks = installURLMocks();
      const anchor = captureAnchor();
      anchor.install();
      try {
        exportReplayToFile(makeReplay(), "my-replay.json");
        expect(urlMocks.createObjectURL).toHaveBeenCalledTimes(1);
        expect(urlMocks.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
        expect(anchor.capture()!.download).toBe("my-replay.json");
        expect(anchor.capture()!.href).toBe("blob:fake");
      } finally {
        urlMocks.restore();
      }
    });

    it("derives a default filename from the replay id", () => {
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

  describe("importReplayFromFile", () => {
    it("parses a JSON replay file", async () => {
      const replay = makeReplay();
      const file = { text: async () => JSON.stringify(replay) } as unknown as File;

      const imported = await importReplayFromFile(file);

      expect(imported).not.toBeNull();
      expect(imported!.id).toBe("replay-1");
      expect(imported!.metadata).toEqual(replay.metadata);
    });

    it("returns null for malformed JSON", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      const file = { text: async () => "{ broken" } as unknown as File;

      expect(await importReplayFromFile(file)).toBeNull();
    });

    it("returns null when reading the file fails", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      const file = {
        text: async () => {
          throw new Error("read failed");
        },
      } as unknown as File;

      expect(await importReplayFromFile(file)).toBeNull();
    });
  });

  describe("importReplayFromURL", () => {
    const g = globalThis as { fetch?: unknown };

    afterEach(() => {
      delete g.fetch;
    });

    it("GETs the replay and returns it on success", async () => {
      const replay = makeReplay();
      const fetchMock = jest
        .fn<(input: string, init?: unknown) => Promise<unknown>>()
        .mockResolvedValue({ ok: true, status: 200, json: async () => replay });
      g.fetch = fetchMock;

      const imported = await importReplayFromURL("srv-1", "https://srv.example");

      expect(imported).not.toBeNull();
      expect(imported!.id).toBe("replay-1");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://srv.example/api/replays/srv-1",
      );
    });

    it("returns null on a non-ok response", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      g.fetch = jest
        .fn<(input: string, init?: unknown) => Promise<unknown>>()
        .mockResolvedValue({ ok: false, status: 404 });

      expect(
        await importReplayFromURL("srv-1", "https://srv.example"),
      ).toBeNull();
    });

    it("returns null when the request fails", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      g.fetch = jest
        .fn<(input: string, init?: unknown) => Promise<unknown>>()
        .mockRejectedValue(new Error("offline"));

      expect(
        await importReplayFromURL("srv-1", "https://srv.example"),
      ).toBeNull();
    });
  });

  describe("canShareViaURL / getEstimatedURLLength", () => {
    it("allows a small replay", () => {
      expect(canShareViaURL(makeReplay())).toBe(true);
      expect(getEstimatedURLLength(makeReplay())).toBeGreaterThan(0);
    });

    it("rejects a replay that is too large", () => {
      jest.spyOn(console, "warn").mockImplementation(() => {});
      const base = makeReplay();
      const huge = makeReplay({
        actions: Array.from({ length: 400 }, (_, i) => ({
          sequenceNumber: i,
          action: {
            type: "cast_spell",
            playerId: "p1",
            timestamp: FIXED_NOW + i,
            data: { cardId: `c${i}`, padding: "x".repeat(40) },
          },
          resultingState: base.actions[0].resultingState,
          description: `action ${i} `.repeat(20),
          recordedAt: FIXED_NOW + i,
        })),
        totalActions: 400,
      } as unknown as Partial<Replay>);

      expect(canShareViaURL(huge)).toBe(false);
    });

    it("returns false / -1 when the replay cannot be encoded", () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      const replay = makeReplay();
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      (replay.actions[0].action as { data: unknown }).data = circular;

      expect(canShareViaURL(replay)).toBe(false);
      expect(getEstimatedURLLength(replay)).toBe(-1);
    });

    it("estimates a positive length for a shareable replay", () => {
      expect(getEstimatedURLLength(makeReplay())).toBeGreaterThan(0);
    });
  });
});
