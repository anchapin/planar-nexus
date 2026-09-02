# AI Provider Setup Runbook

Step-by-step guide to obtaining, configuring, validating, and switching AI
provider API keys. This is the linear runbook companion to
[`docs/API.md`](./API.md) §3 (AI Providers) — the reference doc — and covers
the most common first-stop integration task: **get key → set env var →
validate → switch provider**.

> **You do not need any API key to use Planar Nexus.** See
> [Zero-config / heuristic fallback](#zero-config--heuristic-fallback) below.

All AI calls go through a server-side proxy (`/api/ai-proxy`) so keys never
reach the browser. Keys are read from **server-side environment variables**
(`.env` / `.env.local` at the repo root) by
[`src/ai/providers/factory.ts`](../src/ai/providers/factory.ts) and
[`src/lib/server-api-key-storage.ts`](../src/lib/server-api-key-storage.ts).
After changing a key, restart the dev server (`npm run dev`, port **9002**).

---

## Zero-config / heuristic fallback

With **no keys set at all**, the app still works:

- **Deck coaching** falls back to a heuristic-based analyzer that needs no
  external AI service (see the note in [`README.md`](../README.md) quickstart
  and [`docs/API.md`](./API.md) §1).
- **Conversational coach** yields a graceful fallback message when no provider
  is configured — it does not hang or crash (issue #446).

Everything below is optional and only needed for full LLM-powered features.

---

## Provider runbooks

Four built-in providers are supported. The wire `provider` ids are
`openai`, `anthropic`, `google`, `zaic` (plus `custom` for any
OpenAI-compatible endpoint — see
[Switching provider and model](#switching-provider-and-model)).

Each subsection follows the same three steps: **get a key → set the env var →
validate**.

### 1. OpenAI (GPT)

1. **Get a key** — sign in at the
   [OpenAI Platform → API keys](https://platform.openai.com/api-keys) and
   create a new secret key (starts with `sk-`). Usage-based billing applies.
2. **Set the env var** — in `.env` (copy from
   [`.env.example`](../.env.example)):

   ```bash
   OPENAI_API_KEY=sk-...
   ```

3. **Validate** — restart the dev server, then:

   ```bash
   curl 'http://localhost:9002/api/ai-proxy/validate?provider=openai'
   ```

   `{"success":true,"provider":"openai","valid":true,...}` means the key works.

### 2. Anthropic (Claude)

1. **Get a key** — sign in at the
   [Anthropic Console](https://console.anthropic.com/) and create a key
   (starts with `sk-ant-`). Paid only.
2. **Set the env var**:

   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   ```

3. **Validate** — Anthropic is **not** supported by the validate endpoint
   (see [Validating keys](#validating-keys) below). The simplest check is a
   one-shot proxy chat request:

   ```bash
   curl -X POST http://localhost:9002/api/ai-proxy \
     -H 'Content-Type: application/json' \
     -d '{"provider":"anthropic","endpoint":"chat","body":{"messages":[{"role":"user","content":"ping"}]}}'
   ```

   A `PROVIDER_ERROR_401` means the key is bad; anything other than an error
   envelope means the key is live.

### 3. Google (Gemini)

1. **Get a key** — create one at
   [Google AI Studio](https://makersuite.google.com/app/apikey). A free tier
   is available (~60 requests/min).
2. **Set the env var** — the app reads **`GOOGLE_AI_API_KEY`** with
   **`GOOGLE_GENERATIVE_AI_API_KEY`** as a fallback:

   ```bash
   GOOGLE_AI_API_KEY=AIzaSy...
   ```

   > ⚠️ **Do not use `GOOGLE_API_KEY`.** The app does not read that name.
   > `.env.example` currently lists the Google key under `GOOGLE_API_KEY`,
   > which is a known stale entry (issue #1553) — see
   > [`docs/API.md`](./API.md) §4. Set one of the two names above.

3. **Validate**:

   ```bash
   curl 'http://localhost:9002/api/ai-proxy/validate?provider=google'
   ```

### 4. Z.ai (GLM)

1. **Get a key** — sign up at the [Z.ai Platform](https://platform.z.ai/).
   Cost-effective; usage-based pricing.
2. **Set the env var**:

   ```bash
   ZAI_API_KEY=your_key_here
   # Optional — defaults to https://api.z-ai.com/v1:
   # ZAI_BASE_URL=https://api.z-ai.com/v1
   ```

3. **Validate**:

   ```bash
   curl 'http://localhost:9002/api/ai-proxy/validate?provider=zaic'
   ```

---

## Validating keys

`GET /api/ai-proxy/validate?provider=<id>` checks that a **server-side** key
is configured, well-formed, and actually accepted by the provider (it issues
a minimal live request — `GET /models` against the provider API).

| `provider=`   | Supported | Notes                                            |
| ------------- | --------- | ------------------------------------------------ |
| `openai`      | ✅        |                                                  |
| `google`      | ✅        | key sent as query param, never echoed on errors  |
| `zaic`        | ✅        | probes the Z.ai `/models` endpoint               |
| `custom`      | ✅        | probes `<CUSTOM_AI_BASE_URL>/health`             |
| `anthropic`   | ❌        | rejected with `INVALID_PROVIDER` — use the proxy chat probe above |

Error codes (full reference in [`docs/API.md`](./API.md) §2.3):

| HTTP | `errorCode`                 | Meaning / fix                                        |
| ---- | --------------------------- | ---------------------------------------------------- |
| 400  | `MISSING_PROVIDER`          | add `?provider=` to the URL                         |
| 400  | `INVALID_PROVIDER`          | unsupported id (e.g. `anthropic`)                   |
| 400  | `INVALID_KEY_FORMAT`        | key fails format checks (e.g. OpenAI must start `sk-`) — did you paste the whole key? |
| 404  | `PROVIDER_NOT_CONFIGURED`   | env var not set on the server — check `.env`, restart |
| 401  | `VALIDATION_FAILED_<code>`  | provider rejected the key (bad/expired/quota)       |
| 500  | `VALIDATION_ERROR`          | network/probe failure — error text is redacted; quote the `correlationId` when reporting (issue #1585) |

---

## Switching provider and model

There is no provider-settings UI; the **active provider is per-request**.
Any AI-carrying call accepts a `provider` field (and optional model override):

- `POST /api/ai-proxy` — `provider` + `model` (see
  [`docs/API.md`](./API.md) §2.2)
- `POST /api/chat` — `provider` + `modelId` (§2.4)
- `POST /api/chat/coach` — `provider` + `modelId` (§2.5)

Wire ids: `openai` | `anthropic` | `google` | `zaic` | `custom`. If you omit
`provider`, the default is OpenAI for `/api/chat`, and the failover order
below for the coach.

**Failover chain** (issue #1077): your requested provider is tried first;
on failure the remaining providers are tried in the default order
`openai → anthropic → google → zaic`. Providers with no configured key are
skipped (an explicitly requested provider is still attempted). Check what the
server currently has configured:

```bash
curl 'http://localhost:9002/api/ai-proxy?action=status'
# → {"configuredProviders":["openai","google"],"availableProviders":[...]}
```

**Default models** (from `PROVIDER_DEFAULT_MODELS` in
[`src/ai/providers/factory.ts`](../src/ai/providers/factory.ts)):

| Provider            | Default model                 |
| ------------------- | ----------------------------- |
| `openai`            | `gpt-4o-mini`                 |
| `anthropic`         | `claude-3-5-sonnet-20241022`  |
| `google`            | `gemini-1.5-flash-latest`     |
| `zaic` / `custom`   | `gpt-4o-mini`                 |

Override per request, e.g. `"model": "gpt-4o"` on `/api/ai-proxy`.

**Custom provider** (any OpenAI-compatible endpoint): set
`CUSTOM_AI_API_KEY` and `CUSTOM_AI_BASE_URL`, then send
`"provider": "custom"`.

---

## Troubleshooting

| Symptom                                        | Cause / fix                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Coaching works but is generic                  | No key set — you are on the heuristic fallback. This is expected (see [above](#zero-config--heuristic-fallback)). |
| `PROVIDER_NOT_CONFIGURED` (503/404)            | Env var missing/empty on the server. Verify spelling (especially `GOOGLE_AI_API_KEY`, not `GOOGLE_API_KEY`), then restart the dev server. |
| `PROVIDER_ERROR_401` / `VALIDATION_FAILED_401` | Key invalid, revoked, or from the wrong account. Issue a fresh key and re-validate.                |
| `RATE_LIMIT_EXCEEDED` (429) / `PROVIDER_ERROR_429` | Rate limited — either by the proxy (default 100 req/min per user/IP, tunable via `AI_RATE_LIMIT_MAX` / `AI_RATE_LIMIT_WINDOW_MS`) or by the provider's own quota. Honor `retryAfter` and back off. |
| `NETWORK_ERROR` / `INVALID_RESPONSE` (502)     | Proxy could not reach the provider API. Check outbound network / custom base URLs (`NEXT_PUBLIC_*_API_URL`, `ZAI_BASE_URL`, `CUSTOM_AI_BASE_URL`). |
| 500 with a `correlationId`                     | Error details are redacted by design (issue #1585). Search server logs for that correlation id.    |
| Google key set but provider still skipped      | You probably set `GOOGLE_API_KEY` (unread). Use `GOOGLE_AI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`. |

More general problems: see [`docs/TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).
Rate-limit numbers per tier: [`docs/API.md`](./API.md) §5.
