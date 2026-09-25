# Security Policy

## Web Security Headers

The application enforces several HTTP security headers via `next.config.ts` for all routes. These headers protect the application against common web attacks and are derived from a shared allowlist module (`src/lib/security/csp-allowlist.ts`).

### Headers Applied

| Header                      | Value                                              | Purpose                                                                                                                   |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`   | Derived from `WEB_CSP`                             | Mitigates XSS and injection attacks. `frame-ancestors 'none'` also mitigates clickjacking (supersedes `X-Frame-Options`). |
| `X-Content-Type-Options`    | `nosniff`                                          | Prevents MIME-type sniffing attacks.                                                                                      |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                  | Controls referrer information sent with cross-origin requests.                                                            |
| `Strict-Transport-Security` | `max-age=15552000`                                 | Enforces HTTPS for 180 days, pinning the connection for returning visitors.                                               |
| `Permissions-Policy`        | `camera=(self), microphone=(self), payment=(self)` | Restricts sensitive browser APIs to same-origin usage only.                                                               |

### Permissions-Policy

The `Permissions-Policy` header restricts access to sensitive browser features:

- **camera**: Only same-origin pages may access the camera.
- **microphone**: Only same-origin pages may access the microphone.
- **payment**: Only same-origin pages may access the Payment API.

This is particularly important for the P2P WebRTC components, which use `DataChannels` but do not require camera/microphone access. Restricting these to `self` ensures that cross-origin injected iframes cannot prompt the user for these permissions.

### Desktop Shell

The Tauri desktop shell receives its CSP from `src-tauri/tauri.conf.json`. The web headers above cover the browser-served app and are asserted by the `tests/csp-audit.test.ts` regression test.

### Related Issues

- #1273: CSP single-source-of-truth sync between Tauri config and web headers
- #1822: Initial security headers implementation
