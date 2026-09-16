/**
 * Shared P2P inbound trust-pipeline tests — issue #1791.
 *
 * Issue #1791: the 1:1 transport (`P2PGameConnection.handleMessage`) and the
 * N>2 mesh transport (`MeshGameConnection.handleIncoming`) each hand-implemented
 * the identical six-step inbound trust pipeline — a duplication maintained by
 * comment, not by code. Both now delegate to `src/lib/p2p-inbound-pipeline.ts`.
 *
 * This module is the SINGLE place asserting the pipeline contract:
 *
 *   1. The static ordered step registry matches the documented order
 *      (rate limit → parse → shape → anti-replay → role allowlist → legality).
 *   2. `runInboundPipeline` enforces each step, parameterized by BOTH
 *      surfaces' configurations (1:1-shaped and mesh-shaped), including the
 *      fail-closed keyed-link envelope gate and the byte-compatible
 *      rejection logging/counters.
 *   3. The EXECUTED step order is asserted against BOTH real entry points
 *      (via the connections' `pipelineObserver` option), including that the
 *      two surfaces execute the IDENTICAL sequence and that rejections
 *      short-circuit the pipeline (later steps never run).
 *
 * The pre-existing per-surface suites (`p2p-game-connection.test.ts`,
 * `mesh-game-connection.test.ts`) remain as transport-integration
 * regressions over the same pipeline through the public entry points.
 */
import {
  createP2PGameConnection,
  type GameMessage,
  type PeerActionValidator,
} from "../p2p-game-connection";
import {
  MeshGameConnection,
  derivePerSenderKey,
  type PeerLink,
} from "../mesh-game-connection";
import {
  INBOUND_PIPELINE_STEPS,
  INBOUND_PIPELINE_STEP_ORDER,
  P2P_INBOUND_PIPELINE_MESSAGES,
  MESH_INBOUND_PIPELINE_MESSAGES,
  runInboundPipeline,
  validateInboundGameAction,
  type InboundPipelineConfig,
  type InboundStepObserver,
} from "../p2p-inbound-pipeline";
import { AntiReplayTracker } from "../anti-replay-tracker";
import { signMessageEnvelope } from "../p2p-json-validation";
import { p2pLogger } from "../p2p-logger";

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/** A well-formed peer `game-action` (the message type that exercises ALL six steps). */
const gameAction = (
  senderId: string,
  seq: number,
  action = "pass_priority",
): GameMessage => ({
  type: "game-action",
  senderId,
  timestamp: Date.now(),
  seq,
  data: { action, data: {} },
});

/** A well-formed `chat` message (legality gate does not apply → `skipped`). */
const chatMessage = (senderId: string, seq: number): GameMessage => ({
  type: "chat",
  senderId,
  timestamp: Date.now(),
  seq,
  data: { senderName: "Peer", text: "hello" },
});

/** Collect observed (step, outcome) pairs through a {@link InboundStepObserver}. */
const collectSteps = (): { obs: InboundStepObserver; seen: string[] } => {
  const seen: string[] = [];
  return {
    seen,
    obs: (step, outcome) => seen.push(`${step}:${outcome}`),
  };
};

/** Just the step NAMES of an observed sequence (for cross-surface comparison). */
const stepNames = (seen: string[]): string[] =>
  seen.map((entry) => entry.split(":")[0]);

/** The full documented pass sequence (used as the canonical expected order). */
const FULL_PASS_SEQUENCE = INBOUND_PIPELINE_STEP_ORDER.map(
  (name) => `${name}:pass`,
);

/** Observer recorder handed to a connection under test. */
const collectNames = (): { obs: InboundStepObserver; names: string[] } => {
  const names: string[] = [];
  return { names, obs: (step) => names.push(step) };
};

/** Minimal mock transport link for the mesh (mirrors the mesh test suite). */
class MockLink implements PeerLink {
  readonly peerId: string;
  open: boolean;
  closed = false;
  sent: string[] = [];

  constructor(peerId: string, open = true) {
    this.peerId = peerId;
    this.open = open;
  }

  send(raw: string): boolean {
    if (!this.open) return false;
    this.sent.push(raw);
    return true;
  }

  isOpen(): boolean {
    return this.open;
  }

  close(): void {
    this.closed = true;
    this.open = false;
  }
}

/**
 * A pipeline config shaped like the 1:1 transport's (no log context, no
 * sender binding, no envelope payload re-validation, opt-in legality).
 */
const p2pShapedConfig = (
  overrides: Partial<InboundPipelineConfig> = {},
): InboundPipelineConfig => ({
  rateLimiterFor: () => ({ tryAcquire: () => true }),
  wireModeFor: () => ({ kind: "legacy" }),
  antiReplay: new AntiReplayTracker(),
  getLocalRole: () => "player",
  legalityAppliesTo: (message) => message.type === "game-action",
  actionValidator: () => ({ isValid: true }),
  messages: P2P_INBOUND_PIPELINE_MESSAGES,
  logTag: "[P2PGameConnection]",
  logContextFor: () => null,
  ...overrides,
});

/**
 * A pipeline config shaped like the mesh's (link-attributed log context,
 * per-link envelope gate with sender binding + payload re-validation,
 * host-gated legality).
 */
const meshShapedConfig = (
  overrides: Partial<InboundPipelineConfig> = {},
): InboundPipelineConfig => ({
  ...p2pShapedConfig(),
  messages: MESH_INBOUND_PIPELINE_MESSAGES,
  logTag: "[MeshGameConnection]",
  logContextFor: (peerId) => (peerId ? { fromPeerId: peerId } : null),
  ...overrides,
});

/** Envelope-mode config bound to a pairwise key over link `p1` (mesh-shaped). */
const keyedConfig = (
  overrides: Partial<InboundPipelineConfig> = {},
): InboundPipelineConfig => {
  const pairKey = "ab".repeat(32);
  return meshShapedConfig({
    wireModeFor: () => ({
      kind: "envelope" as const,
      resolveVerificationKey: (declaredSenderId) =>
        derivePerSenderKey(pairKey, declaredSenderId),
      expectedSenderId: "p1",
      revalidatePayloadShape: true,
    }),
    ...overrides,
  });
};

// ──────────────────────────────────────────────────────────────────────────
// 1. Static ordered step registry
// ──────────────────────────────────────────────────────────────────────────

describe("p2p-inbound-pipeline — ordered step registry", () => {
  it("exports the documented six-step order", () => {
    expect([...INBOUND_PIPELINE_STEP_ORDER]).toEqual([
      "rate-limit",
      "parse",
      "shape",
      "anti-replay",
      "role-allowlist",
      "legality",
    ]);
  });

  it("INBOUND_PIPELINE_STEPS is an ordered sequence of named validators", () => {
    expect(INBOUND_PIPELINE_STEPS.map((step) => step.name)).toEqual([
      ...INBOUND_PIPELINE_STEP_ORDER,
    ]);
    for (const step of INBOUND_PIPELINE_STEPS) {
      expect(typeof step.validate).toBe("function");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Pipeline semantics, parameterized over BOTH surfaces' configs
// ──────────────────────────────────────────────────────────────────────────

describe.each([
  ["1:1 (P2PGameConnection-shaped)", p2pShapedConfig],
  ["mesh (MeshGameConnection-shaped)", meshShapedConfig],
])("runInboundPipeline — %s", (_label, makeConfig) => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(p2pLogger, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(p2pLogger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("accepts a well-formed game-action and reports the full six-step pass order", () => {
    const { obs, seen } = collectSteps();
    const result = runInboundPipeline(
      JSON.stringify(gameAction("p1", 0)),
      makeConfig({ onStep: obs }),
    );
    expect(result.outcome).toBe("accepted");
    expect(seen).toEqual([...FULL_PASS_SEQUENCE]);
  });

  it("reports the legality step as skipped for a non-game-action message", () => {
    const { obs, seen } = collectSteps();
    const result = runInboundPipeline(
      JSON.stringify(chatMessage("p1", 0)),
      makeConfig({ onStep: obs }),
    );
    expect(result.outcome).toBe("accepted");
    expect(seen).toEqual([
      "rate-limit:pass",
      "parse:pass",
      "shape:pass",
      "anti-replay:pass",
      "role-allowlist:pass",
      "legality:skipped",
    ]);
  });

  it("short-circuits at the rate-limit step: parse never runs for a flooding peer", () => {
    const { obs, seen } = collectSteps();
    const result = runInboundPipeline(
      "{ not json", // would fail parse — must never get there
      makeConfig({
        rateLimiterFor: () => ({ tryAcquire: () => false }),
        onStep: obs,
      }),
    );
    expect(result).toEqual({ outcome: "rejected", step: "rate-limit" });
    expect(seen).toEqual(["rate-limit:reject"]);
  });

  it("rejects malformed JSON at the parse step (structural limits / bad JSON)", () => {
    const { obs, seen } = collectSteps();
    const result = runInboundPipeline(
      "{ not json",
      makeConfig({ onStep: obs }),
    );
    expect(result).toEqual({ outcome: "rejected", step: "parse" });
    expect(seen).toEqual(["rate-limit:pass", "parse:reject"]);
  });

  it("rejects oversize payloads at the parse step before any shape work", () => {
    const oversize = `{"pad":"${"x".repeat(300 * 1024)}"}`;
    const result = runInboundPipeline(oversize, makeConfig());
    expect(result).toEqual({ outcome: "rejected", step: "parse" });
  });

  it("rejects valid JSON of the wrong shape at the shape step", () => {
    const result = runInboundPipeline(
      JSON.stringify({ foo: "bar" }),
      makeConfig(),
    );
    expect(result).toEqual({ outcome: "rejected", step: "shape" });
  });

  it("rejects a well-shaped message missing the required seq field (#1091)", () => {
    const noSeq = {
      type: "game-action",
      senderId: "p1",
      timestamp: Date.now(),
      data: { action: "pass_priority", data: {} },
    };
    const result = runInboundPipeline(JSON.stringify(noSeq), makeConfig());
    expect(result).toEqual({ outcome: "rejected", step: "shape" });
  });

  it("rejects a duplicate seq at the anti-replay step and never runs later steps", () => {
    const { obs, seen } = collectSteps();
    const config = makeConfig({ onStep: obs });
    const raw = JSON.stringify(gameAction("p1", 3));
    expect(runInboundPipeline(raw, config).outcome).toBe("accepted");
    const replay = runInboundPipeline(raw, config);
    expect(replay).toEqual({ outcome: "rejected", step: "anti-replay" });
    expect(seen[seen.length - 1]).toBe("anti-replay:reject");
    // The replayed run executed ONLY through anti-replay.
    expect(stepNames(seen.slice(0, 6))).toEqual([
      "rate-limit",
      "parse",
      "shape",
      "anti-replay",
      "role-allowlist",
      "legality",
    ]);
    expect(stepNames(seen.slice(6))).toEqual([
      "rate-limit",
      "parse",
      "shape",
      "anti-replay",
    ]);
  });

  it("advances the anti-replay high-water mark even when a LATER step rejects (role-drop is counted once)", () => {
    const antiReplay = new AntiReplayTracker();
    const config = makeConfig({
      antiReplay,
      getLocalRole: () => "spectator",
    });
    const result = runInboundPipeline(
      JSON.stringify(gameAction("p1", 7)),
      config,
    );
    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.step).toBe("role-allowlist");
    }
    // The role-dropped message still marked its seq applied — a replay of it
    // is rejected by anti-replay, not re-counted as a role drop.
    expect(antiReplay.getLastApplied("p1")).toBe(7);
  });

  it("drops a game-action disallowed for a read-only local role at the role-allowlist step (#1253)", () => {
    const onRoleDisallowed = jest.fn();
    const { obs, seen } = collectSteps();
    const result = runInboundPipeline(
      JSON.stringify(gameAction("p1", 0)),
      makeConfig({
        getLocalRole: () => "spectator",
        onRoleDisallowed,
        onStep: obs,
      }),
    );
    expect(result).toEqual({ outcome: "rejected", step: "role-allowlist" });
    expect(onRoleDisallowed).toHaveBeenCalledTimes(1);
    expect(stepNames(seen)).toEqual([
      "rate-limit",
      "parse",
      "shape",
      "anti-replay",
      "role-allowlist",
    ]);
  });

  it("rejects an illegal action at the legality step and surfaces the reason (#1089)", () => {
    const { obs, seen } = collectSteps();
    const result = runInboundPipeline(
      JSON.stringify(gameAction("p1", 0)),
      makeConfig({
        actionValidator: () => ({
          isValid: false,
          reason: "not your turn",
        }),
        onStep: obs,
      }),
    );
    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.step).toBe("legality");
      expect(result.reason).toBe("not your turn");
      expect(result.message?.seq).toBe(0);
    }
    expect(seen[seen.length - 1]).toBe("legality:reject");
  });

  it("skips the legality gate when it does not apply (chat messages)", () => {
    const actionValidator = jest.fn();
    const result = runInboundPipeline(
      JSON.stringify(chatMessage("p1", 0)),
      makeConfig({ actionValidator }),
    );
    expect(result.outcome).toBe("accepted");
    expect(actionValidator).not.toHaveBeenCalled();
  });

  it("rejects a non-string input at the parse step without throwing", () => {
    const result = runInboundPipeline(
      undefined as unknown as string,
      makeConfig(),
    );
    expect(result).toEqual({ outcome: "rejected", step: "parse" });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2b. Rejection logging is byte-compatible per surface
// ──────────────────────────────────────────────────────────────────────────

describe("runInboundPipeline — rejection logging per surface", () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(p2pLogger, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(p2pLogger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("the 1:1 surface logs malformed messages as SINGLE-argument rejections (pre-#1791 byte format)", () => {
    runInboundPipeline("{ not json", p2pShapedConfig());
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[P2PGameConnection] Rejected malformed peer message",
    );
  });

  it("the mesh surface logs malformed messages with the redacted link context", () => {
    runInboundPipeline("{ not json", meshShapedConfig(), "p1");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[MeshGameConnection] Rejected malformed peer message",
      expect.anything(),
    );
  });

  it("the 1:1 surface logs replays with the sender/seq context only", () => {
    const config = p2pShapedConfig();
    const raw = JSON.stringify(gameAction("p1", 1));
    runInboundPipeline(raw, config);
    runInboundPipeline(raw, config);
    expect(warnSpy).toHaveBeenCalledWith(
      "[P2PGameConnection] Dropping duplicate/replay message",
      expect.anything(),
    );
  });

  it("the mesh surface logs rate-limit rejections attributed to the flooding link", () => {
    runInboundPipeline(
      "irrelevant",
      meshShapedConfig({ rateLimiterFor: () => ({ tryAcquire: () => false }) }),
      "flood-peer",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[MeshGameConnection] Rate limit exceeded; dropping peer message",
      expect.anything(),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2c. Keyed-link envelope gate (fail closed)
// ──────────────────────────────────────────────────────────────────────────

describe("runInboundPipeline — keyed-link envelope gate (#1708)", () => {
  const pairKey = "ab".repeat(32);

  it("accepts an envelope signed under the per-sender subkey of the link's pairwise secret", () => {
    const message = gameAction("p1", 0);
    const envelope = signMessageEnvelope(
      message,
      derivePerSenderKey(pairKey, "p1"),
    );
    const result = runInboundPipeline(
      JSON.stringify(envelope),
      keyedConfig(),
      "p1",
    );
    expect(result.outcome).toBe("accepted");
  });

  it("fails closed on non-enveloped (legacy) traffic on a keyed link", () => {
    const onEnvelopeRejected = jest.fn();
    const result = runInboundPipeline(
      JSON.stringify(gameAction("p1", 0)),
      keyedConfig({ onEnvelopeRejected }),
      "p1",
    );
    expect(result).toEqual({ outcome: "rejected", step: "shape" });
    expect(onEnvelopeRejected).toHaveBeenCalledTimes(1);
  });

  it("rejects an envelope signed under a different key (forged signature)", () => {
    const onEnvelopeRejected = jest.fn();
    const envelope = signMessageEnvelope(gameAction("p1", 0), "ff".repeat(32));
    const result = runInboundPipeline(
      JSON.stringify(envelope),
      keyedConfig({ onEnvelopeRejected }),
      "p1",
    );
    expect(result).toEqual({ outcome: "rejected", step: "shape" });
    expect(onEnvelopeRejected).toHaveBeenCalledTimes(1);
  });

  it("rejects an envelope whose declared sender is not the delivering link (swapped senderId)", () => {
    // Signed correctly under p2's per-sender subkey, but delivered on p1's
    // link — the sender-to-link binding rejects it.
    const envelope = signMessageEnvelope(
      gameAction("p2", 0),
      derivePerSenderKey(pairKey, "p2"),
    );
    const result = runInboundPipeline(
      JSON.stringify(envelope),
      keyedConfig(),
      "p1",
    );
    expect(result).toEqual({ outcome: "rejected", step: "shape" });
  });

  it("rejects an envelope whose payload fails the full GameMessage shape guard (mesh re-validation)", () => {
    const bogusType = {
      type: "not-a-game-message-type",
      senderId: "p1",
      timestamp: Date.now(),
      seq: 0,
      data: null,
    };
    const envelope = signMessageEnvelope(
      bogusType,
      derivePerSenderKey(pairKey, "p1"),
    );
    const onEnvelopeRejected = jest.fn();
    const result = runInboundPipeline(
      JSON.stringify(envelope),
      keyedConfig({ onEnvelopeRejected }),
      "p1",
    );
    expect(result).toEqual({ outcome: "rejected", step: "shape" });
    expect(onEnvelopeRejected).toHaveBeenCalledTimes(1);
  });

  it("the 1:1 surface preserves its historical no-payload-revalidation envelope behavior", () => {
    // The 1:1 transport historically does NOT re-run isGameMessage on the
    // verified payload (the envelope guard checks the HMAC-participating
    // subset only). Byte-compatible with pre-#1791 behavior.
    const bogusType = {
      type: "not-a-game-message-type",
      senderId: "peer",
      timestamp: Date.now(),
      seq: 0,
      data: null,
    };
    const envelope = signMessageEnvelope(bogusType, pairKey);
    const config = p2pShapedConfig({
      wireModeFor: () => ({
        kind: "envelope" as const,
        resolveVerificationKey: () => pairKey,
        expectedSenderId: undefined,
        revalidatePayloadShape: false,
      }),
    });
    const result = runInboundPipeline(JSON.stringify(envelope), config);
    expect(result.outcome).toBe("accepted");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2d. Shared legality validator (fail-closed matrix)
// ──────────────────────────────────────────────────────────────────────────

describe("validateInboundGameAction — shared fail-closed validator (#1089)", () => {
  it("rejects a malformed action payload (no action string) without calling the validator", () => {
    const validator = jest.fn();
    const result = validateInboundGameAction(
      { ...gameAction("p1", 0), data: { nope: true } },
      validator,
    );
    expect(result).toEqual({ isValid: false, reason: "Malformed game action" });
    expect(validator).not.toHaveBeenCalled();
  });

  it("fail-closes when the gate is enabled but no validator is wired", () => {
    const result = validateInboundGameAction(gameAction("p1", 0), null);
    expect(result).toEqual({
      isValid: false,
      reason: "No action validator configured",
    });
  });

  it("treats a throwing validator as a rejection (never applies)", () => {
    const result = validateInboundGameAction(gameAction("p1", 0), () => {
      throw new Error("engine exploded");
    });
    expect(result).toEqual({ isValid: false, reason: "engine exploded" });
  });

  it("rejects a validator returning a non-result", () => {
    const bogusValidator = (() => "yes") as unknown as PeerActionValidator;
    const result = validateInboundGameAction(
      gameAction("p1", 0),
      bogusValidator,
    );
    expect(result).toEqual({
      isValid: false,
      reason: "Invalid validator result",
    });
  });

  it("passes through a legal verdict and forwards the sender + payload", () => {
    const validator = jest.fn(() => ({ isValid: true }));
    const message = gameAction("p1", 4, "draw_card");
    const result = validateInboundGameAction(message, validator);
    expect(result).toEqual({ isValid: true });
    expect(validator).toHaveBeenCalledWith(
      { action: "draw_card", data: {} },
      "p1",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. Executed step order against BOTH real entry points
// ──────────────────────────────────────────────────────────────────────────

describe("step ORDER against the real entry points (issue #1791)", () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(p2pLogger, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(p2pLogger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const handleMessage = (conn: unknown, raw: string): void =>
    (conn as unknown as { handleMessage: (d: string) => void }).handleMessage(
      raw,
    );

  it("P2PGameConnection.handleMessage executes the six steps in the documented order", () => {
    const { obs, names } = collectNames();
    const onMessage = jest.fn();
    const conn = createP2PGameConnection({
      playerId: "host",
      playerName: "Host",
      role: "host",
      validatePeerActions: true,
      validatePeerAction: () => ({ isValid: true }),
      pipelineObserver: obs,
      events: { onMessage },
    });
    handleMessage(conn, JSON.stringify(gameAction("peer", 0)));
    expect(names).toEqual([...INBOUND_PIPELINE_STEP_ORDER]);
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it("MeshGameConnection.handleIncoming executes the IDENTICAL step order", () => {
    const p2pOrder = collectNames();
    const meshOrder = collectNames();

    const p2pConn = createP2PGameConnection({
      playerId: "host",
      playerName: "Host",
      role: "host",
      validatePeerActions: true,
      validatePeerAction: () => ({ isValid: true }),
      pipelineObserver: p2pOrder.obs,
      events: { onMessage: jest.fn() },
    });
    handleMessage(p2pConn, JSON.stringify(gameAction("peer", 0)));

    const mesh = new MeshGameConnection({
      localPlayerId: "host",
      localPlayerName: "Host",
      hostId: "host",
      isHost: true,
      validatePeerActions: true,
      validatePeerAction: () => ({ isValid: true }),
      pipelineObserver: meshOrder.obs,
      heartbeat: { intervalMs: 0 },
      events: { onMessage: jest.fn() },
    });
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(JSON.stringify(gameAction("p1", 0)), "p1");

    // The SAME pipeline, by code: both surfaces execute the documented order.
    expect(meshOrder.names).toEqual([...INBOUND_PIPELINE_STEP_ORDER]);
    expect(meshOrder.names).toEqual(p2pOrder.names);
    mesh.close();
  });

  it("P2PGameConnection envelope mode runs the same six steps (shape = envelope gate)", () => {
    const { obs, names } = collectNames();
    const key = "cd".repeat(32);
    const conn = createP2PGameConnection({
      playerId: "host",
      playerName: "Host",
      role: "host",
      sessionKeyHex: key,
      validatePeerActions: true,
      validatePeerAction: () => ({ isValid: true }),
      pipelineObserver: obs,
      events: { onMessage: jest.fn() },
    });
    handleMessage(
      conn,
      JSON.stringify(signMessageEnvelope(gameAction("peer", 0), key)),
    );
    expect(names).toEqual([...INBOUND_PIPELINE_STEP_ORDER]);
  });

  it("MeshGameConnection keyed link runs the same six steps (shape = envelope gate)", () => {
    const { obs, names } = collectNames();
    const pairKey = "ef".repeat(32);
    const mesh = new MeshGameConnection({
      localPlayerId: "host",
      localPlayerName: "Host",
      hostId: "host",
      isHost: true,
      validatePeerActions: true,
      validatePeerAction: () => ({ isValid: true }),
      pipelineObserver: obs,
      heartbeat: { intervalMs: 0 },
      events: { onMessage: jest.fn() },
    });
    mesh.addPeerLink(new MockLink("p1"));
    expect(mesh.setPeerSessionKey("p1", pairKey)).toBe(true);
    mesh.handleIncoming(
      JSON.stringify(
        signMessageEnvelope(
          gameAction("p1", 0),
          derivePerSenderKey(pairKey, "p1"),
        ),
      ),
      "p1",
    );
    expect(names).toEqual([...INBOUND_PIPELINE_STEP_ORDER]);
    mesh.close();
  });

  it("a replayed message short-circuits at anti-replay on BOTH surfaces (role/legality never run)", () => {
    // 1:1 surface
    const p2pSeen = collectSteps();
    const conn = createP2PGameConnection({
      playerId: "host",
      playerName: "Host",
      role: "host",
      validatePeerActions: true,
      validatePeerAction: () => ({ isValid: true }),
      pipelineObserver: p2pSeen.obs,
      events: { onMessage: jest.fn() },
    });
    const raw = JSON.stringify(gameAction("peer", 1));
    handleMessage(conn, raw);
    handleMessage(conn, raw); // duplicate seq
    // Second run (entries 7..10): the pipeline stopped at anti-replay — the
    // role-allowlist and legality steps NEVER executed for the replay.
    expect(p2pSeen.seen.slice(6)).toEqual([
      "rate-limit:pass",
      "parse:pass",
      "shape:pass",
      "anti-replay:reject",
    ]);

    // Mesh surface
    const meshSeen = collectSteps();
    const mesh = new MeshGameConnection({
      localPlayerId: "host",
      localPlayerName: "Host",
      hostId: "host",
      isHost: true,
      validatePeerActions: true,
      validatePeerAction: () => ({ isValid: true }),
      pipelineObserver: meshSeen.obs,
      heartbeat: { intervalMs: 0 },
      events: { onMessage: jest.fn() },
    });
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(raw, "p1");
    mesh.handleIncoming(raw, "p1"); // duplicate seq
    expect(meshSeen.seen.slice(6)).toEqual([
      "rate-limit:pass",
      "parse:pass",
      "shape:pass",
      "anti-replay:reject",
    ]);
    mesh.close();
  });

  it("rate limiting runs BEFORE parsing on the 1:1 surface (a flooded malformed payload never reaches the parser)", () => {
    const { obs, seen } = collectSteps();
    const conn = createP2PGameConnection({
      playerId: "host",
      playerName: "Host",
      role: "host",
      rateLimit: { maxMessages: 1, windowMs: 60_000 },
      pipelineObserver: obs,
      events: { onMessage: jest.fn() },
    });
    handleMessage(conn, JSON.stringify(chatMessage("peer", 0))); // consumes the single token
    errorSpy.mockClear();
    handleMessage(conn, "{ not json"); // malformed — but must be dropped BEFORE parsing
    expect(seen[seen.length - 1]).toBe("rate-limit:reject");
    expect(errorSpy).not.toHaveBeenCalled(); // parse step never logged a malformed rejection
  });

  it("a spectator local role drops a game-action at the role-allowlist step (legality never runs)", () => {
    const { obs, seen } = collectSteps();
    const validator = jest.fn(() => ({ isValid: true }));
    const conn = createP2PGameConnection({
      playerId: "host",
      playerName: "Host",
      role: "host",
      localRole: "spectator",
      validatePeerActions: true,
      validatePeerAction: validator,
      pipelineObserver: obs,
      events: { onMessage: jest.fn() },
    });
    handleMessage(conn, JSON.stringify(gameAction("peer", 0)));
    expect(seen[seen.length - 1]).toBe("role-allowlist:reject");
    expect(validator).not.toHaveBeenCalled();
    expect(conn.getSpectatorDrops()).toBe(1);
  });

  it("an illegal action rejects at the legality step AFTER the earlier five steps passed (1:1)", () => {
    const { obs, seen } = collectSteps();
    const onMessage = jest.fn();
    const conn = createP2PGameConnection({
      playerId: "host",
      playerName: "Host",
      role: "host",
      validatePeerActions: true,
      validatePeerAction: () => ({ isValid: false, reason: "illegal" }),
      pipelineObserver: obs,
      events: { onMessage },
    });
    handleMessage(conn, JSON.stringify(gameAction("peer", 0)));
    expect(seen).toEqual([
      "rate-limit:pass",
      "parse:pass",
      "shape:pass",
      "anti-replay:pass",
      "role-allowlist:pass",
      "legality:reject",
    ]);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("a NON-host mesh skips the legality gate even with a validator wired (host-only gate)", () => {
    const { obs, seen } = collectSteps();
    const validator = jest.fn(() => ({ isValid: false, reason: "illegal" }));
    const onMessage = jest.fn();
    const mesh = new MeshGameConnection({
      localPlayerId: "p2",
      localPlayerName: "P2",
      hostId: "host",
      isHost: false,
      validatePeerActions: true,
      validatePeerAction: validator,
      pipelineObserver: obs,
      heartbeat: { intervalMs: 0 },
      events: { onMessage },
    });
    mesh.addPeerLink(new MockLink("p1"));
    mesh.handleIncoming(JSON.stringify(gameAction("p1", 0)), "p1");
    expect(seen).toEqual([
      "rate-limit:pass",
      "parse:pass",
      "shape:pass",
      "anti-replay:pass",
      "role-allowlist:pass",
      "legality:skipped",
    ]);
    expect(validator).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledTimes(1); // non-host forwards untouched
    mesh.close();
  });
});
