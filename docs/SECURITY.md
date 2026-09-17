# Security Posture

Notes for operators on what this codebase enforces server-side and what
configuration it requires to keep enforcing it. The threat surface
covered here is the AI rate limiter that guards the paid provider keys
in `src/lib/server-rate-limiter.ts`; the rest of the codebase ships
without a server boundary in the single-instance dev path.

## AI rate limiter — multi-instance contract (issue #1782)

The server-side rate limiter on `/api/ai-proxy`, `/api/chat`, and
`/api/chat/coach` is the abuse-control surface for paid provider keys
(per #1393: "the app has no auth yet — the rate limit is the entire
abuse control"). The pre-#1782 implementation stored bucket state in a
module-scope `LRUCache`, which made the limiter per-instance: each warm
process enforced its own window and the effective abuse ceiling on a
multi-replica / serverless deploy was `maxRequests × instance-count`
rather than `maxRequests`.

This is the same architectural flaw that retired the signaling session
store in #1730, except the rate limiter fails open and invisibly —
limits appear to work in single-instance dev.

### Backend options

The limiter's storage is now pluggable. Two backends ship in-tree:

| Backend                      | Env var                             | Deployment target           | Notes                                                     |
| ---------------------------- | ----------------------------------- | --------------------------- | --------------------------------------------------------- |
| `InMemoryRateLimiterBackend` | unset / `RATE_LIMIT_BACKEND=memory` | Single-instance dev only    | Per-instance. **NOT safe for production multi-instance.** |
| `RedisRateLimiterBackend`    | `RATE_LIMIT_BACKEND=redis`          | Multi-instance / serverless | Shared Upstash Redis via HTTP REST.                       |

Selection happens lazily on the first call into the singleton. The
selection function throws at construction time on any of:

- `RATE_LIMIT_BACKEND=redis` without both `REDIS_URL` and `REDIS_TOKEN` set.
- `RATE_LIMIT_BACKEND=<anything-else>`.

The throw is intentional: a silent fallback to the in-memory backend
would re-introduce the very bug this module retires.

### Configuration

Required env vars when `RATE_LIMIT_BACKEND=redis`:

```
RATE_LIMIT_BACKEND=redis
REDIS_URL=https://<instance>.upstash.io
REDIS_TOKEN=<upstash-rest-token>
```

Optional knobs (the defaults are sane for production traffic; tune only
with a measured reason):

| Env var                   | Default | Meaning                                                                                               |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `AI_RATE_LIMIT_MAX`       | 100     | Per-bucket request ceiling inside the window. Per-route overrides exist (`AI_RATE_LIMIT_MAX_OPENAI`). |
| `AI_RATE_LIMIT_WINDOW_MS` | 60000   | Fixed-window length. Each window has its own counter; the next window starts a fresh budget.          |
| `AI_RATE_LIMIT_TTL_MS`    | 300000  | LRU TTL on the in-memory backend only. Ignored when the redis backend is selected.                    |

### Wire format

The `RedisRateLimiterBackend` speaks the Upstash Redis HTTP REST
contract directly via `fetch()`. No `ioredis`, no
`@upstash/ratelimit`, no protocol buffers, no Node-only socket layer
— the same primitive Cloudflare Workers and Vercel Edge functions
reach for when they need a KV primitive from outside Node.

Per-check cost: two requests (`GET`, then `SET` with TTL on the
admit path). Fixed-window semantics: a single Redis string per bucket,
JSON `{ count, windowFloor }`, TTL = `ceil(windowMs / 1000) + 1`
seconds. Idle buckets self-evict; no janitor process is needed.

### Failure mode

The limiter fails closed. A Redis timeout (default 1s per request via
`AbortSignal.timeout`) throws; the AI routes turn that into a 500.
Failing open (silently admitting on backend error) would lift the rate
limit entirely — the exact failure mode #1782 retires. If you observe
500s during a Redis outage, the alternative is worse.

### Testing the multi-instance contract

The two-instance integration test in
`src/lib/__tests__/server-rate-limiter.test.ts` is gated on
`RATE_LIMIT_TEST_BACKEND_URL` and `RATE_LIMIT_TEST_BACKEND_TOKEN`.
When unset the suite is `describe.skip`-ed; when set, the test
constructs two limiter instances against the same Redis URL and
asserts instance A's writes are visible to instance B. CI does not
have a Redis; a developer with an Upstash database can run:

```
RATE_LIMIT_TEST_BACKEND_URL=https://my-instance.upstash.io \
RATE_LIMIT_TEST_BACKEND_TOKEN=<token> \
  npm test -- --testPathPatterns=server-rate-limiter
```

### Why a custom Redis client over `@upstash/ratelimit`

The `@upstash/ratelimit` package is a sliding-window wrapper around
`@upstash/redis`. It is the right choice when a project does not own
its limiter implementation; here we already do (and now we own two
backends behind one interface), so the dependency buys us ~50 lines of
logic we would still own locally. The Upstash REST `GET`/`SET`/`DEL`/
`SCAN` calls we use directly add up to ~200 lines in-tree and zero
installed deps.

## Module-scope state — a recurring failure class

`src/lib/server-rate-limiter.ts` was not the first piece of module-scope
state to look fine in dev and silently break in production:

- **#1730** — the signaling session store (`src/app/api/signaling/`)
  shipped with `export const dynamic = "force-static"` while polling a
  module-scope in-memory `Map`. In multi-instance/serverless deploys
  the GET was build-time cached and POST state was per-instance. The
  route now returns 410 Gone for every verb; see
  `src/app/api/signaling/route.ts` for the deprecation notice.
- **#1782** (this issue) — the AI rate limiter stored bucket state in
  a module-scope `LRUCache`. Same class of failure, different sink:
  the signaling store fails closed (the UI just hangs); the rate
  limiter fails open (an attacker burns through the operator's provider
  budget).

Any new piece of state that needs to be shared across processes must
go through an explicit shared backend (Redis, a durable KV, etc.) —
not a module-scope `Map`/`LRUCache`/`Set`. The lint config does not
yet enforce this; the architectural-review checklist should.

## Reporting a vulnerability

This repo follows GitHub-style private disclosure: open a private
security advisory on the repository's Security tab rather than filing
a public issue.
