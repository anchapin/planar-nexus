/**
 * Signaling Server API Route — RETIRED (issues #641, #1730).
 *
 * The server-dependent session-store API is gone. It shipped with
 * `export const dynamic = "force-static"` while polling a module-scope
 * in-memory Map: in any multi-instance/serverless deployment the GET was
 * build-time cached and POST state was per-instance, so offers/candidates
 * never reached the other peer — a silent hang instead of an error.
 *
 * Every session-store endpoint (create / join / offer / answer /
 * ice-candidate / poll / close, via GET / POST / DELETE) now returns
 * **410 Gone** with a JSON body naming the replacement.
 *
 * Use serverless P2P instead:
 * - `src/lib/p2p-direct-connection.ts` for QR code / manual code exchange
 * - `src/lib/p2p-signaling-client.ts` for client-side signaling
 * - `/multiplayer/p2p-host` and `/multiplayer/p2p-join` for the UI
 *
 * NOTE: `/api/signaling/turn-credentials/` is a separate, ACTIVE route
 * (TURN relay credentials — issue #1583) and is not affected by this
 * retirement.
 */

import { NextResponse } from "next/server";

/** 410 body: machine-readable deprecation + the replacement path. */
const GONE_BODY = {
  error: "The signaling session-store API has been removed.",
  status: 410,
  deprecated: true,
  replacement: "src/lib/p2p-direct-connection.ts",
  migration: "Use the serverless P2P direct connection (QR/manual code exchange). See issues #641 and #1730.",
} as const;

/** All retired session-store verbs answer 410 Gone (issue #1730). */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

export async function DELETE(): Promise<NextResponse> {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

/**
 * Alphabet for game codes. 32 symbols chosen to exclude visually-ambiguous
 * characters (I, O, 0, 1) so codes remain readable when entered by hand.
 *
 * With 6 characters this yields 32^6 = 1,073,741,824 possible codes ≈ 2^30
 * of entropy. See `generateGameCode` below for the cryptographic-sampling
 * rationale (issue #1568).
 */
const GAME_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GAME_CODE_LENGTH = 6;

/**
 * Generate a short, cryptographically random game code.
 *
 * Retained (exported, unused by the retired handlers) because it is the
 * canonical CSPRNG sampling pattern that issue #1568 locked down with
 * regression tests; the direct P2P code exchange inherits the same
 * requirements. See `__tests__/route.test.ts`.
 *
 * Implementation:
 *   1. Draw a fresh byte from `globalThis.crypto.getRandomValues` (Web
 *      Crypto API) for each of the 6 output positions.
 *   2. Use rejection sampling against the threshold
 *      `256 - (256 % alphabetSize)` so the per-symbol distribution is
 *      exactly uniform — no modulo bias.
 *
 * SECURITY (issue #1568): never fall back to `Math.random()`. A silent
 * fallback would defeat the security goal; a hard failure is the only
 * observable signal that the environment is unsafe for game-code issuance.
 * If `globalThis.crypto.getRandomValues` is unavailable this function
 * THROWS a descriptive error.
 */
export function generateGameCode(): string {
  if (
    typeof globalThis.crypto === "undefined" ||
    typeof globalThis.crypto.getRandomValues !== "function"
  ) {
    throw new Error(
      "generateGameCode requires globalThis.crypto.getRandomValues " +
        "(Web Crypto API). Runtime does not provide a cryptographically " +
        "secure RNG; refusing to fall back to Math.random. (issue #1568)",
    );
  }
  const getRandomBytes = globalThis.crypto.getRandomValues.bind(
    globalThis.crypto,
  );
  // Largest multiple of the alphabet length that still fits in [0, 256).
  // Bytes >= THRESHOLD are rejected and re-drawn to remove modulo bias.
  const THRESHOLD = 256 - (256 % GAME_CODE_ALPHABET.length);
  const buf = new Uint8Array(1);
  let code = "";
  for (let i = 0; i < GAME_CODE_LENGTH; i++) {
    let byte: number;
    // Rejection-sample. For the current 32-symbol alphabet THRESHOLD === 256
    // and this loop body runs exactly once; the do/while is kept so the
    // algorithm remains correct if the alphabet ever changes.
    do {
      getRandomBytes(buf);
      byte = buf[0];
    } while (byte >= THRESHOLD);
    code += GAME_CODE_ALPHABET[byte % GAME_CODE_ALPHABET.length];
  }
  return code;
}
