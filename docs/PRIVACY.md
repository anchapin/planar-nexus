# Privacy Policy — Planar Nexus Telemetry

> Applies to: Planar Nexus desktop (Tauri) and web builds.
> Related issue: [#1112 — Add opt-in crash and error telemetry](https://github.com/anchapin/planar-nexus/issues/1112)

Planar Nexus is a **local-first, privacy-first** application. Your card
collection, decks, and games are stored on your device and are never uploaded by
this application. This document describes the **strictly opt-in** crash and
error telemetry introduced in #1112, and exactly what it does and does not
collect.

## Summary

|               | Default                   | When enabled                                                |
| ------------- | ------------------------- | ----------------------------------------------------------- |
| **Telemetry** | **OFF** — nothing is sent | Anonymous crash/error reports are sent when an error occurs |

Telemetry is **disabled by default**. It is enabled only by an explicit,
deliberate action in **Settings → Privacy & Telemetry**. Until you turn it on,
no telemetry of any kind is collected or transmitted. You can turn it off at any
time; reporting stops immediately.

## What we collect (only when you opt in)

When telemetry is enabled and an error occurs, the application sends a single
small JSON payload containing **only** these fields:

| Field        | Description                                  | Example                                     |
| ------------ | -------------------------------------------- | ------------------------------------------- |
| `type`       | The error class/type name                    | `"TypeError"`                               |
| `message`    | The error message, **sanitized** (see below) | `"Cannot read properties of undefined"`     |
| `stack`      | The stack trace, **sanitized**               | `"at foo (bar.ts:12:5)"`                    |
| `surface`    | A coarse tag for where it happened           | `"SW"` \| `"AI"` \| `"P2P"` \| `"renderer"` |
| `appVersion` | The application version                      | `"1.0.0"`                                   |
| `timestamp`  | ISO-8601 time the error was captured         | `"2026-06-26T04:55:25.818Z"`                |

That is the complete set. There is no other data attached.

The sources of errors that are captured:

- **Uncaught renderer exceptions** (`window.onerror`) and **unhandled promise
  rejections** (`unhandledrejection`).
- **Service-worker failures** (registration, cache, update errors from
  `service-worker-registration.tsx`).
- **AI-flow errors** (failures reported from AI features, surfaced as `"AI"`).
- **P2P-flow errors** (failures reported from peer-to-peer features, surfaced as
  `"P2P"`).

The `surface` tag is deliberately **coarse** — we record _that_ an error
happened in the P2P subsystem, never _which_ peer, room, or game it involved.

## What we never collect

The telemetry payload schema is closed and does not include any of the
following. They are **never** transmitted by this telemetry:

- ❌ **Card data** — card names, oracle text, mana costs, images, set data.
- ❌ **Deck contents** — deck lists, deck names/ids, sideboards, card counts.
- ❌ **Game state** — board state, hands, life totals, scores, replay data.
- ❌ **Peer / player identities** — peer ids, player names, room codes,
  connection ids.
- ❌ **Network identifiers** — IP addresses, ICE candidates, STUN/TURN URLs or
  credentials.
- ❌ **Account / auth data** — API keys, tokens, email addresses, user ids.
- ❌ **Device fingerprints** — hardware IDs, advertising IDs, install IDs.
- ❌ **Usage analytics** — no event tracking, session recording, click tracking,
  or performance monitoring beyond the error reports above.

## Sanitization (defense-in-depth)

Even though the payload schema never attaches the data above, an `Error`'s
`message` or `stack` could incidentally echo sensitive text. Before any field is
transmitted it is run through a sanitizer that:

1. **Redacts** recognized sensitive substrings, replacing them with
   `[REDACTED]`:
   - `key=value` / `key:value` tokens for sensitive keys (`peerId`, `deckId`,
     `deckName`, `cardName`, `roomCode`, `token`, `password`, `secret`,
     `email`, …).
   - **UUIDs** (peer/connection identifiers in this app are UUIDs).
   - **Email addresses**.
   - **URL query strings and fragments** (may carry room codes or tokens).
2. **Truncates** any field longer than 4096 characters.

The sanitizer is pure and unit-tested in
`src/lib/__tests__/telemetry.test.ts`.

## Where data goes

This application does not bundle a telemetry backend. Telemetry is delivered to
an **ingestion endpoint** configured by the operator/self-hoster via the
`NEXT_PUBLIC_TELEMETRY_ENDPOINT` environment variable at build time (for
example, a self-hosted [GlitchTip](https://glitchtip.com/) or Sentry
project — or any endpoint that accepts a JSON POST).

- If **no endpoint is configured**, the telemetry transport is a safe **no-op**:
  payloads are never sent anywhere, even after you opt in.
- When an endpoint is configured, payloads are sent via `navigator.sendBeacon`
  where available (fire-and-forget, survives page unload), falling back to
  `fetch(..., { keepalive: true })`. Requests are made with
  `credentials: "omit"` — no cookies or auth headers are attached.

If you are building/distributing Planar Nexus yourself, **you control** where
this data (if any) is sent. Leave `NEXT_PUBLIC_TELEMETRY_ENDPOINT` unset to
disable transmission entirely.

## Consent & control

- **Consent is off by default** and stored locally in your browser/app storage
  under the key `planar-nexus:telemetry-consent`.
- Consent is **re-checked on every error** before anything is sent, so turning
  the toggle off stops reporting **immediately** (no batched/background queue).
- Toggling consent **never transmits anything itself** — flipping the switch on
  only permits future error reports.
- Clearing your browser/app storage resets consent to off.

## Open source

The entire telemetry implementation is open source and auditable:

- Module: [`src/lib/telemetry.ts`](../src/lib/telemetry.ts)
- Tests: [`src/lib/__tests__/telemetry.test.ts`](../src/lib/__tests__/telemetry.test.ts)
- Settings UI: [`src/components/telemetry-settings.tsx`](../src/components/telemetry-settings.tsx)

If anything in this document ever disagrees with the code, **the code is the
source of truth** — please open an issue.
