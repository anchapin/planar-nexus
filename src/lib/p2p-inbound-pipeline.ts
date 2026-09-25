/**
 * Shared P2P inbound trust pipeline — issue #1791.
 *
 * Both game transports (`P2PGameConnection` for 1:1 sessions and
 * `MeshGameConnection` for N>2 pods) accept `GameMessage`s from UNTRUSTED
 * peers over WebRTC data channels. Until #1791 each transport
 * hand-implemented the SAME six-step inbound trust pipeline, a duplication
 * maintained by comment ("enforces, in order, the SAME pipeline as ...")
 * rather than by code — the #1708/#1767 envelope-key rework had to land in
 * both surfaces, and the next security fix that only lands in one would
 * silently weaken the other.
 *
 * This module is now the SINGLE owner of the ordered inbound trust boundary
 * (per docs/P2P_SYNC_OWNERSHIP.md). The pipeline executes, in order:
 *
 *   1. `rate-limit`      — a flooding peer is dropped before ANY parsing
 *                          work is done (issue #1111). One independent
 *                          counter per delivering link.
 *   2. `parse`           — safe parse with structural limits (byte cap,
 *                          nesting depth, key-count) via `safeParseJson`
 *                          (issue #1111 / GHSA-96hv-2xvq-fx4p class).
 *   3. `shape`           — shape validation: the shared `isGameMessage`
 *                          guard on legacy links, or the per-link HMAC
 *                          envelope gate on keyed links (issues #1252 /
 *                          #1708 — fails closed, no downgrade to unsigned).
 *   4. `anti-replay`     — a message with `seq <=` the highest seq already
 *                          applied from this `senderId` is dropped BEFORE it
 *                          can touch game state (issue #1091). The accepted
 *                          seq is marked applied immediately, so a message
 *                          rejected later (role/legality) still advances the
 *                          high-water mark.
 *   5. `role-allowlist`  — per-peer role allowlist (issue #1253): a
 *                          `game-action` arriving on a read-only
 *                          (spectator/moderator) stream is dropped before it
 *                          can touch the dispatch surface.
 *   6. `legality`        — host-side rules-engine legality (issue #1089): on
 *                          the authoritative host a `game-action` is
 *                          validated against the host's OWN state; illegal
 *                          actions are rejected BEFORE being emitted.
 *
 * The step ORDER is load-bearing (an illegal action must never touch host
 * game state; a flooding peer must never consume parse CPU; a replayed
 * action is counted once by anti-replay before the role gate runs) and is
 * asserted against BOTH real transport entry points by
 * `src/lib/__tests__/p2p-inbound-pipeline.test.ts`.
 *
 * Rejection behavior is delegated, not duplicated: the pipeline owns the
 * control flow, logging (level + exact message text), and diagnostic
 * counter hooks, parameterized by each connection's
 * {@link InboundPipelineConfig} (log tag, log context, wire mode, roles,
 * legality gate). The connections keep only their per-surface reject
 * DELIVERY (e.g. the typed `error` message sent back to a peer whose action
 * the host rejected).
 */

import {
  isGameMessage,
  type GameMessage,
  type PeerActionValidator,
  type PeerActionValidationResult,
  type PeerGameActionPayload,
} from "./p2p-game-connection";
import { hmacSha256Hex } from "./p2p-handshake";
import {
  safeParseJson,
  isMessageEnvelope,
  isMessageEnvelopeShallow,
  verifyMessageEnvelope,
  canonicalMessageForHmac,
  type GameMessageLike,
  type MessageEnvelope,
} from "./p2p-json-validation";
import type { AntiReplayTracker } from "./anti-replay-tracker";
import { isMessageAllowedForRole, type PeerRole } from "./peer-role";
import { redactSensitive } from "./p2p-log-redact";
import { p2pLogger } from "./p2p-logger";

// ──────────────────────────────────────────────────────────────────────────
// Ordered step registry
// ──────────────────────────────────────────────────────────────────────────

/**
 * The documented inbound trust-pipeline order. Exported as the canonical
 * sequence so tests (and future reviewers) can assert that the executed
 * pipeline matches the spec — see the module header.
 */
export const INBOUND_PIPELINE_STEP_ORDER = [
  "rate-limit",
  "parse",
  "shape",
  "anti-replay",
  "role-allowlist",
  "legality",
] as const;

/** Name of one step of the inbound trust pipeline. */
export type InboundPipelineStepName =
  (typeof INBOUND_PIPELINE_STEP_ORDER)[number];

/**
 * Terminal outcome of one executed step:
 *   - `"pass"`    — the message cleared the step.
 *   - `"reject"`  — the message was rejected at this step (pipeline stops).
 *   - `"skipped"` — the step ran but did not apply (e.g. the legality gate
 *                   is not active for this message) and let the message
 *                   through.
 */
export type InboundStepOutcome = "pass" | "reject" | "skipped";

/**
 * Observer invoked once per executed pipeline step with the step's terminal
 * outcome. Steps after a rejecting step are NOT invoked (the pipeline
 * short-circuits), so the observed sequence is exactly the executed order.
 * Wired in by the connections via their `pipelineObserver` option for tests
 * and diagnostics.
 */
export type InboundStepObserver = (
  step: InboundPipelineStepName,
  outcome: InboundStepOutcome,
) => void;

// ──────────────────────────────────────────────────────────────────────────
// Wire modes (step 2/3 configuration)
// ──────────────────────────────────────────────────────────────────────────

/** Legacy (unkeyed) wire mode: plain shape-validated `GameMessage` JSON. */
export interface LegacyWireMode {
  readonly kind: "legacy";
}

/**
 * Keyed (envelope) wire mode: the payload MUST be a `MessageEnvelope`
 * verifying under a per-link/per-sender symmetric key (issues #1252 / #1708).
 * Fails closed — non-enveloped traffic on a keyed link is rejected, never
 * downgraded to unsigned.
 */
export interface EnvelopeWireMode {
  readonly kind: "envelope";
  /**
   * Resolve the verification key for an inbound envelope declaring
   * `declaredSenderId`. Called AFTER the envelope shape check, so the
   * declared sender is well-formed. The 1:1 transport returns its session
   * key; the mesh derives the per-sender subkey of the delivering link's
   * pairwise secret (`derivePerSenderKey`).
   */
  resolveVerificationKey(declaredSenderId: string): string;
  /**
   * When set, additionally requires `envelope.payload.senderId ===
   * expectedSenderId` (sender bound to the delivering link — the mesh's
   * anti-forgery check from #1708). `undefined` skips the binding check
   * (1:1 sessions have exactly one possible sender).
   */
  readonly expectedSenderId?: string;
  /**
   * Re-run the full `isGameMessage` shape guard on the envelope payload
   * after HMAC verification. The envelope guard checks only the
   * HMAC-participating subset; the mesh (which cannot assume its peers'
   * key material implies payload shape) re-validates. The 1:1 transport
   * historically does not — preserved byte-for-byte.
   */
  readonly revalidatePayloadShape?: boolean;
}

/** Wire mode selected per inbound message by the receiving connection. */
export type InboundWireMode = LegacyWireMode | EnvelopeWireMode;

// ──────────────────────────────────────────────────────────────────────────
// Rejection phrasing (per-surface message presets)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Exact log message texts (WITHOUT the connection's `[Tag]` prefix, which
 * the pipeline prepends) emitted when a step rejects a message. These are
 * part of the cross-surface rejection contract — other layers, log-based
 * diagnostics, and existing tests match on them — so they are frozen here
 * per surface rather than re-typed at each rejection site.
 */
export interface InboundPipelineMessages {
  /** `rate-limit` step rejection (warn). */
  readonly rateLimited: string;
  /** `parse`/`shape` rejection on a legacy link (error). */
  readonly malformedMessage: string;
  /** `parse`/`shape` rejection on a keyed link (warn; fail closed). */
  readonly envelopeMalformed: string;
  /** Envelope HMAC / sender-binding failure (warn). */
  readonly envelopeForged: string;
  /** Envelope payload failed the full `GameMessage` shape guard (warn). */
  readonly envelopePayloadShape: string;
  /** `anti-replay` step rejection (warn). */
  readonly replayDropped: string;
  /** `role-allowlist` step rejection (warn). */
  readonly roleDisallowed: string;
}

/**
 * 1:1 transport (`P2PGameConnection`) rejection phrasing. Byte-identical to
 * the messages the connection emitted before the pipeline was extracted.
 */
export const P2P_INBOUND_PIPELINE_MESSAGES: InboundPipelineMessages = {
  rateLimited: "Rate limit exceeded; dropping peer message",
  malformedMessage: "Rejected malformed peer message",
  envelopeMalformed: "Rejected malformed envelope",
  envelopeForged: "envelope-sender-mismatch; dropping forged envelope",
  envelopePayloadShape: "Envelope payload failed GameMessage shape validation",
  replayDropped: "Dropping duplicate/replay message",
  roleDisallowed: "Dropped message disallowed for local role",
};

/**
 * Mesh transport (`MeshGameConnection`) rejection phrasing. Byte-identical
 * to the messages the connection emitted before the pipeline was extracted.
 */
export const MESH_INBOUND_PIPELINE_MESSAGES: InboundPipelineMessages = {
  rateLimited: "Rate limit exceeded; dropping peer message",
  malformedMessage: "Rejected malformed peer message",
  envelopeMalformed:
    "Rejected non-enveloped/malformed traffic on keyed link (fail closed)",
  envelopeForged: "Dropping forged/invalid envelope",
  envelopePayloadShape: "Envelope payload failed GameMessage shape validation",
  replayDropped: "Dropping duplicate/replay message",
  roleDisallowed: "Dropped message disallowed for local role",
};

// ──────────────────────────────────────────────────────────────────────────
// Pipeline configuration
// ──────────────────────────────────────────────────────────────────────────

/** Rate limiter surface consumed by the `rate-limit` step. */
export interface InboundRateLimiterLike {
  tryAcquire(): boolean;
}

/**
 * Per-connection configuration the pipeline is parameterized by. The
 * callbacks are invoked per message so live state (rotated session keys,
 * updated roles, promoted hosts) is always respected — connections must NOT
 * snapshot mutable values into the config.
 */
export interface InboundPipelineConfig {
  /**
   * The rate limiter governing the delivering link (step 1). The 1:1
   * transport returns its single per-connection limiter; the mesh returns
   * the per-peer limiter (creating it lazily so a message that races link
   * registration is still protected).
   */
  rateLimiterFor(fromPeerId: string | undefined): InboundRateLimiterLike;
  /**
   * Wire mode for THIS inbound message (steps 2/3). Keyed links fail
   * closed; see {@link EnvelopeWireMode}.
   */
  wireModeFor(fromPeerId: string | undefined): InboundWireMode;
  /** Shared per-sender anti-replay high-water-mark state (step 4). */
  readonly antiReplay: AntiReplayTracker;
  /** Local peer's role — the single source of truth for the step-5 gate. */
  getLocalRole(): PeerRole;
  /**
   * Whether the host-side legality gate (step 6) applies to `message`. The
   * 1:1 transport gates on the `validatePeerActions` opt-in; the mesh
   * additionally requires the local client to be the authoritative host.
   */
  legalityAppliesTo(message: GameMessage): boolean;
  /** Rules-engine validator supplied by the host, or `null` (fail-closed). */
  readonly actionValidator: PeerActionValidator | null;
  /** Rejection phrasing for this surface (see presets above). */
  readonly messages: InboundPipelineMessages;
  /** Log tag prepended to every pipeline log line (e.g. `"[P2PGameConnection]"`). */
  readonly logTag: string;
  /**
   * Extra redacted log context for this message, or `null` when the surface
   * logs rejections without a context argument (the 1:1 transport). The
   * mesh returns `{ fromPeerId }` so every rejection is attributable to a
   * link.
   */
  logContextFor?(
    fromPeerId: string | undefined,
  ): Record<string, unknown> | null;
  /** Diagnostic hook: an inbound envelope failed the keyed-link gate. */
  onEnvelopeRejected?(): void;
  /** Diagnostic hook: an inbound message was dropped by the role allowlist. */
  onRoleDisallowed?(): void;
  /** Optional step observer (tests / diagnostics). See {@link InboundStepObserver}. */
  readonly onStep?: InboundStepObserver;
}

// ──────────────────────────────────────────────────────────────────────────
// Step results
// ──────────────────────────────────────────────────────────────────────────

/** A step's verdict: pass (optionally marked skipped) or reject. */
export type InboundStepVerdict =
  | { readonly pass: true; readonly skipped?: boolean }
  | {
      readonly pass: false;
      /** Machine-readable rejection detail (legality reason). */
      readonly reason?: string;
      /** The rejected message, when the rejecting step has one (legality). */
      readonly message?: GameMessage;
    };

/** Result of running the pipeline over one inbound wire payload. */
export type InboundPipelineResult =
  | { readonly outcome: "accepted"; readonly message: GameMessage }
  | {
      readonly outcome: "rejected";
      /** The step that rejected the message. */
      readonly step: InboundPipelineStepName;
      /** Rejection detail (e.g. the legality reason surfaced to the sender). */
      readonly reason?: string;
      /** The rejected message, when the rejecting step has one (legality). */
      readonly message?: GameMessage;
    };

// ──────────────────────────────────────────────────────────────────────────
// Internal per-run state threaded through the steps
// ──────────────────────────────────────────────────────────────────────────

/** Per-run state threaded through the ordered steps. */
export interface InboundRunState {
  readonly raw: string;
  readonly fromPeerId: string | undefined;
  readonly config: InboundPipelineConfig;
  /** Wire mode resolved once at run start (consumed by parse/shape). */
  wireMode: InboundWireMode;
  /** Output of the `parse` step (a structurally-valid parsed object). */
  parsed: Record<string, unknown> | null;
  /** The trusted `GameMessage` produced by the `shape` step. */
  message: GameMessage | null;
}

/**
 * One ordered pipeline step: a {@link InboundPipelineStepName name} plus its
 * validator. Validators own their step's side effects (diagnostic counters,
 * rejection logs, anti-replay marking) so the rejection behavior lives in
 * exactly one place.
 */
export interface InboundPipelineStep {
  readonly name: InboundPipelineStepName;
  validate(state: InboundRunState): InboundStepVerdict;
}

// ──────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────

/**
 * Structural-parse guard handed to `safeParseJson` by the `parse` step.
 * `safeParseJson` only invokes the guard on an already-parsed non-null
 * object, so this predicate is effectively always true — its purpose is to
 * keep the parse step (structural limits only) separated from the `shape`
 * step (`isGameMessage` / envelope guard), matching the documented order.
 */
const isParsedPayload = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Emit a pipeline rejection log line through `p2pLogger`. When `context` is
 * `null` the call is made WITHOUT a second argument so surfaces that log
 * single-argument rejections (the 1:1 transport) stay byte-identical; when
 * present it is redacted (#982) exactly as the connections did.
 */
function logRejection(
  config: InboundPipelineConfig,
  level: "warn" | "error",
  text: string,
  context: Record<string, unknown> | null,
): void {
  const message = `${config.logTag} ${text}`;
  if (context) {
    p2pLogger[level](message, redactSensitive(context));
  } else {
    p2pLogger[level](message);
  }
}

/** Resolve this run's optional log context (never throws). */
function logContextFor(state: InboundRunState): Record<string, unknown> | null {
  try {
    return state.config.logContextFor?.(state.fromPeerId) ?? null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// The ordered steps
// ──────────────────────────────────────────────────────────────────────────

/** Step 1 — per-link rate limit; a flooder never reaches the parser. */
const rateLimitStep: InboundPipelineStep = {
  name: "rate-limit",
  validate(state) {
    const limiter = state.config.rateLimiterFor(state.fromPeerId);
    if (!limiter.tryAcquire()) {
      logRejection(
        state.config,
        "warn",
        state.config.messages.rateLimited,
        logContextFor(state),
      );
      return { pass: false };
    }
    return { pass: true };
  },
};

/** Step 2 — safe parse + structural limits (size / depth / key-count). */
const parseStep: InboundPipelineStep = {
  name: "parse",
  validate(state) {
    const parsed = safeParseJson<Record<string, unknown>>(
      state.raw,
      isParsedPayload,
    );
    if (parsed === null) {
      // On a keyed link the same structural limits guard the envelope wire
      // payload and the rejection uses the envelope phrasing (fail closed).
      if (state.wireMode.kind === "envelope") {
        state.config.onEnvelopeRejected?.();
        logRejection(
          state.config,
          "warn",
          state.config.messages.envelopeMalformed,
          logContextFor(state),
        );
      } else {
        logRejection(
          state.config,
          "error",
          state.config.messages.malformedMessage,
          logContextFor(state),
        );
      }
      return { pass: false };
    }
    state.parsed = parsed;
    return { pass: true };
  },
};

/** Step 3 — shape validation: `isGameMessage`, or the envelope gate on keyed links. */
const shapeStep: InboundPipelineStep = {
  name: "shape",
  validate(state) {
    const parsed = state.parsed;
    if (state.wireMode.kind === "legacy") {
      if (!parsed || !isGameMessage(parsed)) {
        logRejection(
          state.config,
          "error",
          state.config.messages.malformedMessage,
          logContextFor(state),
        );
        return { pass: false };
      }
      state.message = parsed;
      return { pass: true };
    }

    // Keyed link — envelope mode, fail closed at every sub-check.
    if (!parsed) {
      return { pass: false, outcome: "rejected" };
    }
    if (
      state.wireMode.revalidatePayloadShape
        ? !isMessageEnvelope(parsed)
        : !isMessageEnvelopeShallow(parsed)
    ) {
      state.config.onEnvelopeRejected?.();
      logRejection(
        state.config,
        "warn",
        state.config.messages.envelopePayloadShape,
        logContextFor(state),
      );
      return { pass: false, outcome: "rejected" };
    }
    const envelope = parsed as unknown as MessageEnvelope;
    // HMAC under the per-sender verification key of THIS link (+ optional
    // sender binding to the delivering link). An envelope signed under any
    // other pair key — or bearing a swapped senderId — fails here even if
    // the attacker holds their own link's key (issue #1708).
    const senderKey = state.wireMode.resolveVerificationKey(
      (envelope.payload as { senderId?: string }).senderId ?? "",
    );
    if (
      state.wireMode.revalidatePayloadShape
        ? !verifyMessageEnvelope(
            envelope,
            senderKey,
            state.wireMode.expectedSenderId,
          )
        : !(
            hmacSha256Hex(
              senderKey,
              canonicalMessageForHmac(
                envelope.payload as unknown as GameMessageLike,
              ),
            ) === envelope.hmac
          )
    ) {
      state.config.onEnvelopeRejected?.();
      const ep = envelope.payload as
        { senderId?: string; seq?: number } | undefined;
      logRejection(state.config, "warn", state.config.messages.envelopeForged, {
        ...logContextFor(state),
        declaredSender: ep?.senderId,
        seq: ep?.seq,
      });
      return { pass: false };
    }
    const message = envelope.payload as GameMessage;
    if (state.wireMode.revalidatePayloadShape && !isGameMessage(message)) {
      state.config.onEnvelopeRejected?.();
      logRejection(
        state.config,
        "warn",
        state.config.messages.envelopePayloadShape,
        logContextFor(state),
      );
      return { pass: false };
    }
    state.message = message;
    return { pass: true };
  },
};

/** Step 4 — per-sender anti-replay high-water mark (issue #1091). */
const antiReplayStep: InboundPipelineStep = {
  name: "anti-replay",
  validate(state) {
    const message = state.message as GameMessage;
    if (state.config.antiReplay.isReplay(message.senderId, message.seq)) {
      logRejection(state.config, "warn", state.config.messages.replayDropped, {
        senderId: message.senderId,
        seq: message.seq,
      });
      return { pass: false };
    }
    // Mark applied immediately: a message rejected by a LATER step (role
    // allowlist / legality) still advances the high-water mark, so it can
    // never be replayed as a "fresh" message.
    state.config.antiReplay.markApplied(message.senderId, message.seq);
    return { pass: true };
  },
};

/** Step 5 — per-peer role allowlist (issue #1253). */
const roleAllowlistStep: InboundPipelineStep = {
  name: "role-allowlist",
  validate(state) {
    const message = state.message as GameMessage;
    const localRole = state.config.getLocalRole();
    if (!isMessageAllowedForRole(localRole, message.type)) {
      state.config.onRoleDisallowed?.();
      logRejection(state.config, "warn", state.config.messages.roleDisallowed, {
        ...logContextFor(state),
        type: message.type,
        localRole,
      });
      return { pass: false };
    }
    return { pass: true };
  },
};

/** Step 6 — host-side rules-engine legality for `game-action`s (issue #1089). */
const legalityStep: InboundPipelineStep = {
  name: "legality",
  validate(state) {
    const message = state.message as GameMessage;
    if (!state.config.legalityAppliesTo(message)) {
      // Gate not active for this message (not a game-action, opt-in off, or
      // the local client is not the authoritative host) — the pipeline lets
      // it through and the observer records the step as skipped.
      return { pass: true, skipped: true };
    }
    const result = validateInboundGameAction(
      message,
      state.config.actionValidator,
    );
    if (!result.isValid) {
      return { pass: false, reason: result.reason, message };
    }
    return { pass: true };
  },
};

/**
 * The ordered pipeline: the exported sequence of named steps `runInboundPipeline`
 * executes. Static order is asserted against
 * {@link INBOUND_PIPELINE_STEP_ORDER} by the shared pipeline test.
 */
export const INBOUND_PIPELINE_STEPS: readonly InboundPipelineStep[] = [
  rateLimitStep,
  parseStep,
  shapeStep,
  antiReplayStep,
  roleAllowlistStep,
  legalityStep,
];

// ──────────────────────────────────────────────────────────────────────────
// Executor + shared legality validator
// ──────────────────────────────────────────────────────────────────────────

/**
 * Run the ordered inbound trust pipeline over one raw wire payload.
 *
 * Short-circuits at the FIRST rejecting step (later steps never run — their
 * side effects, logs, and counters are skipped), invokes the optional
 * {@link InboundPipelineConfig.onStep} observer per executed step, and
 * returns the accepted {@link GameMessage} or a rejection identifying the
 * step (plus the legality `reason`/`message` so the connection can notify
 * the originating peer).
 *
 * Never throws — malformed input is a rejection, not an exception (the
 * connections' catch blocks remain for dispatch-handler bugs only).
 */
export function runInboundPipeline(
  raw: string,
  config: InboundPipelineConfig,
  fromPeerId?: string,
): InboundPipelineResult {
  const state: InboundRunState = {
    raw,
    fromPeerId,
    config,
    wireMode: config.wireModeFor(fromPeerId) ?? { kind: "legacy" },
    parsed: null,
    message: null,
  };
  for (const step of INBOUND_PIPELINE_STEPS) {
    const verdict = step.validate(state);
    if (!verdict.pass) {
      config.onStep?.(step.name, "reject");
      return {
        outcome: "rejected",
        step: step.name,
        reason: verdict.reason,
        message: verdict.message,
      };
    }
    config.onStep?.(step.name, verdict.skipped === true ? "skipped" : "pass");
  }
  const message = state.message;
  if (!message) {
    // Defensive: every accepting path sets `state.message` in the shape
    // step. Unreachable in practice; fail closed rather than emit null.
    return { outcome: "rejected", step: "shape" };
  }
  return { outcome: "accepted", message };
}

/**
 * Validate a peer-originated `game-action` against the rules engine using
 * the host's authoritative state (via the supplied {@link PeerActionValidator}).
 * Shared verbatim by both transports (previously duplicated as the private
 * `validatePeerGameAction` on each connection). Defensive against malformed
 * payloads and throwing validators: anything that cannot be confirmed legal
 * is treated as illegal (fail-closed) so it can never be applied to host
 * state. Issue #1089.
 */
export function validateInboundGameAction(
  message: GameMessage,
  validator: PeerActionValidator | null,
): PeerActionValidationResult {
  const payload = message.data;
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { action?: unknown }).action !== "string"
  ) {
    return { isValid: false, reason: "Malformed game action" };
  }
  if (!validator) {
    // Gate enabled without a validator — fail-closed.
    return { isValid: false, reason: "No action validator configured" };
  }
  const peerAction = payload as PeerGameActionPayload;
  try {
    const result = validator(peerAction, message.senderId);
    if (
      result &&
      typeof result === "object" &&
      typeof result.isValid === "boolean"
    ) {
      return result;
    }
    return { isValid: false, reason: "Invalid validator result" };
  } catch (error) {
    // A throwing validator is treated as a rejection — never apply.
    return {
      isValid: false,
      reason:
        error instanceof Error ? error.message : "Action validation error",
    };
  }
}
