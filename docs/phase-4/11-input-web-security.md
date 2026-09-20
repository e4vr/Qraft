# Input and web security

## Input/query safety

- Security-sensitive endpoints parse bounded JSON and select explicit fields rather than spreading request objects into privileged records.
- Imports validate schema, required fields, item counts, nested option data, queue status, bank authority, and idempotency. Unexpected role/plan/owner fields do not become authority.
- D1 statements in reviewed paths use `prepare(...).bind(...)`; no confirmed user-input SQL concatenation was found.
- Framework text rendering escapes user content. No application `dangerouslySetInnerHTML` path was found in the reviewed feature boundaries.
- CSV export now neutralizes spreadsheet formula prefixes (`=`, `+`, `-`, `@`, tab, carriage return).

## CSRF/CORS

State-changing cookie requests call same-origin validation. The session cookie is SameSite=Lax and Secure. Authenticated APIs do not expose permissive credentialed CORS. WebSockets require the exact allowed Origin. This architecture does not add a redundant token when Origin + SameSite covers the current same-origin client.

## Response headers

`server/http/security-headers.ts` wraps non-101 Worker responses. HTML receives CSP; HTTPS receives HSTS. All responses receive `X-Content-Type-Options: nosniff`, clickjacking protection, strict-origin referrer policy, Permissions Policy, COOP and CORP.

Current CSP intentionally retains `'unsafe-inline'` for scripts/styles because Vinext/RSC and existing bootstrap output require compatibility. It does not allow `'unsafe-eval'` or broad `*`. Moving to nonces/hashes and adding CSP reporting remains future hardening.

Production error bodies are generic; structured server logs avoid returning stack traces/SQL details to clients. A deliberately triggered local constraint log appeared only in test process output, not as a client response.
