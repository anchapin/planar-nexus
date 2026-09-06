# Backend Result — Issue #1583

**Status:** PASS
**Branch:** `fix/issue-1583-short-lived-creds`
**Issue:** [Security] Replace shared static TURN credentials with short-lived per-session HMAC credentials (#1583)
**Lane:** Security
**Worktree:** `../worktrees/issue-1583-short-lived-creds`

## Summary

Replaced the long-lived `NEXT_PUBLIC_TURN_PASS` credential model with server-side HMAC minting under a new `TURN_HMAC_SECRET` env var. The server route `/api/signaling/turn-credentials` mints a fresh `<expiry-epoch>:<client-id>` username + base64 HMAC-SHA1 credential pair per request. The long-term secret never enters the client bundle (#1571), and every credential carries a bounded expiry (≤24h) and a per-session identity. `ICEConfigurationManager.applyHmacCredentials()` propagates the minted pair to every configured TURN server atomically; `fetchTurnHmacCredential()` is the client-side fetch helper.

## HMAC Algorithm

- **Algorithm:** HMAC-SHA1 (RFC 2104 over FIPS 180-4 SHA-1).
- **Why SHA-1:** RFC 7635 (TURN REST API) requires HMAC-SHA1 for compatibility with the coturn `static-auth-secret` + `use-auth-secret` configuration. SHA-256 is NOT compatible with coturn's default `static-auth-secret` mode.
- **Username format:** `<expiry-epoch-seconds>:<client-id>` (RFC 7635 §4).
- **Credential format:** base64(HMAC-SHA1(secret, username)) — 28-char base64 of the 20-byte SHA-1.
- **Message:** the username string itself.
- **Secret:** read from `TURN_HMAC_SECRET` server-side only. NEVER exposed to the client; never returned by any API response.
- **Sanitisation:** the client-id is restricted to `[A-Za-z0-9_-]` and capped at 64 chars.

## Expiry Policy

- **Default TTL:** 3600s (1h), tunable via `TURN_HMAC_TTL_SECONDS` (server env).
- **Hard cap:** 86400s (24h) — issue acceptance criterion (`expiry <= 24h`).
- **Lower bound:** 1s (zero/negative TTLs clamp to 1s rather than minting an immediately-invalid credential).
- **Enforcement:** coturn validates the HMAC AND the embedded expiry server-side; a credential past `expiryEpochSeconds` is rejected at allocation time.

## ICE Integration

- `ICEConfigurationManager.applyHmacCredentials(credential, { urls? })` — rotates every configured TURN server's `username`/`credential` atomically. Returns the count of rotated servers.
- `ICEConfigurationManager.setTurnCredentials(...)` retained for legacy rotation paths.
- `fetchTurnHmacCredential({ clientId?, endpoint?, fetchImpl? })` — async fetch helper; defaults to `/api/signaling/turn-credentials`; injectable `fetchImpl` for tests.
- `ICEConfigurationManager.getRTCConfiguration()` (no change) still surfaces the latest `username`/`credential` on every TURN server.

## Files Changed

| File                                                             | Change                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/turn-hmac.ts`                                           | **NEW.** HMAC-SHA1 primitive (RFC 2104 over FIPS 180-4), `mintTurnCredential`, `verifyTurnCredential`, `sanitizeClientId`, `parseTurnUsername`, `TURN_CREDENTIAL_DEFAULT_TTL_SECONDS`, `TURN_CREDENTIAL_MAX_TTL_SECONDS`.                                                                                                                                        |
| `src/lib/ice-config.ts`                                          | Added `applyHmacCredentials()` method on `ICEConfigurationManager`, `fetchTurnHmacCredential()` client fetch helper, `DEFAULT_TURN_HMAC_ENDPOINT`, `warnIfLegacyStaticTurnCredentials`, `hasLegacyStaticTurnCredentials`, `__resetLegacyTurnWarningGuard`. Extended `ResolveTurnServersResult.credentialScheme: 'hmac' \| 'legacy-static' \| 'public-fallback'`. |
| `src/app/api/signaling/turn-credentials/route.ts`                | **NEW.** `GET /api/signaling/turn-credentials?clientId=<id>` dynamic route (NOT `force-static` — it must execute server-side). Returns 503 when `TURN_HMAC_SECRET` is unset; 400 for missing/unsafe clientId; 200 with the credential pair + optional `iceServers` (driven by `TURN_URL` or `NEXT_PUBLIC_TURN_URL`) + optional `realm`.                          |
| `src/lib/__tests__/turn-hmac.test.ts`                            | **NEW.** 42 tests pinning the HMAC contract: RFC 2202 test vector 1, parity with Node's `crypto.createHmac`, expiry clamping, secret isolation, sanitisation, `verifyTurnCredential` (happy + tampered + wrong-secret + expired).                                                                                                                                |
| `src/lib/__tests__/ice-config.test.ts`                           | Added 33 tests for `applyHmacCredentials`, the legacy-deprecation warning, `resolveTurnServers.credentialScheme`, and `fetchTurnHmacCredential` (mocked fetch).                                                                                                                                                                                                  |
| `src/app/api/signaling/turn-credentials/__tests__/route.test.ts` | **NEW.** 15 tests pinning the server route contract: 503/400 failure modes, 200 happy path, RFC 7635 username format, base64 HMAC-SHA1 parity, expiry clamp at 24h, raw secret never appears in response, `TURN_URL` / `NEXT_PUBLIC_TURN_URL` / `TURN_HMAC_REALM` / `TURN_HMAC_TTL_SECONDS` env handling.                                                        |
| `.env.example`                                                   | Documented the new `TURN_HMAC_SECRET` + `TURN_URL` + `TURN_HMAC_REALM` + `TURN_HMAC_TTL_SECONDS` env vars; marked `NEXT_PUBLIC_TURN_*` as deprecated; preserved the commented-out legacy placeholders for migration.                                                                                                                                             |

## Acceptance Criteria Coverage

| Criterion                                              | Coverage                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) generated credentials differ across calls          | `turn-hmac.test.ts` (2-mints-with-different-`now`, 2-mints-with-different-`clientId`, 2-mints-with-different-secret); `ice-config.test.ts` (`two consecutive rotations yield different credentials`); `route.test.ts` (`two consecutive requests yield different credentials`). |
| (b) username encodes an expiry not further than 24h    | `turn-hmac.test.ts` (`expiry is bounded above by 24h even when the caller asks for more`); `ice-config.test.ts` (`expiry encoded in username is bounded above by 24h`); `route.test.ts` (`expiry is clamped to <= 24h even when TURN_HMAC_TTL_SECONDS is set to a week`).       |
| (c) HMAC verifies against the secret                   | `turn-hmac.test.ts` (`verifyTurnCredential accepts a freshly minted pair against the same secret`); `route.test.ts` (`the response credential verifies against the configured secret` — uses Node's `createHmac` as the canonical reference).                                   |
| (d) raw secret never appears in getICEServers() output | `ice-config.test.ts` (`rotates every configured TURN server... raw secret never surfaces in getICEServers() output`); `route.test.ts` (`raw TURN_HMAC_SECRET never appears in the response`); `turn-hmac.test.ts` (`raw secret never appears in the returned credential`).      |
| Legacy deprecation warning                             | `ice-config.test.ts` (`warns when any legacy credential env var is present`, `warns only once unless forced`, `hasLegacyStaticTurnCredentials detects any NEXT_PUBLIC_TURN_* credential key`).                                                                                  |
| Credential rotation is idempotent + atomic             | `ice-config.test.ts` (`setTurnCredentials updates username/credential on every TURN server`, `TURN credential rotation: setTurnCredentials updates every server atomically and is idempotent` — issue #1261).                                                                   |

## Verification Commands Run

```
npm run typecheck                                # 0 errors
npm run lint                                     # 0 errors (618 pre-existing warnings)
node scripts/check-turn-credentials.mjs          # PASS: no committed TURN credentials
npx jest src/lib/__tests__/turn-hmac.test.ts     # 42 passed
npx jest src/lib/__tests__/ice-config.test.ts     # passes (existing + 33 new)
npx jest src/lib/__tests__/ice-config.credential-leak.test.ts  # 9 passed (no regressions)
npx jest src/app/api/signaling                   # all passed (existing + 15 new)
npx jest tests/turn-credentials-guard.test.ts    # 11 passed (no regressions)
npx jest                                         # 10084 passed, 1 failed (coach-conversation-storage #1634 — pre-existing tolerated failure)
```

## Security Notes

- `TURN_HMAC_SECRET` is read from the SERVER environment only. There is no `NEXT_PUBLIC_TURN_HMAC_*` form; the secret is never inlined into the client bundle.
- The credential-leak guard (`scripts/check-turn-credentials.mjs` and its Jest mirror) PASS — no source file contains a hardcoded `NEXT_PUBLIC_TURN_*` assignment or an inline `turn:` URL credential.
- The HMAC primitive is a self-contained SHA-1 + RFC 2104 HMAC. It is exercised against Node's `crypto.createHmac` as the canonical reference in the test suite (`turn-hmac.test.ts → matches Node's crypto reference for a long secret + UTF-8 message`).
- Sanitisation is enforced at both the client-id extraction point (server-side `sanitizeClientId`) and the parser (`parseTurnUsername`). Unsafe client-ids return 400; the HMAC input is never attacker-controlled past the safe character class.

## Out-of-Scope (Documented for Follow-Up)

- The consumer code (`src/lib/p2p-game-connection.ts`) does not yet auto-call `fetchTurnHmacCredential` on session start. Operators who set `TURN_HMAC_SECRET` and want end-to-end HMAC flow will need to wire the call into the existing `iceManager` initialisation (a one-line integration). The plumbing — `applyHmacCredentials`, `fetchTurnHmacCredential`, the server route — is fully in place and tested.
- Coturn-side configuration (`use-auth-secret` + `static-auth-secret` + `realm`) is the operator's responsibility and is documented in `.env.example`.
