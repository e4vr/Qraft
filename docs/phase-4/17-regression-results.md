# Regression results

Date: 2026-09-20. Environment: local Windows development workspace with Miniflare/D1/R2 fixtures. No production connection.

| Check | Result |
|---|---|
| TypeScript `tsc --noEmit` | PASS |
| `oxlint` | PASS |
| Full tests | PASS — 106/106 |
| Platform security/integration test on source | PASS |
| Platform security/integration test on production build | PASS |
| Vinext production build | PASS |
| Wrangler deploy dry-run | PASS — no deployment |
| npm production dependency audit | PASS — 0 vulnerabilities |
| Full dependency audit | PARTIAL — 4 moderate development-only Drizzle/esbuild advisories |

Persona coverage is automated for Lite/Free, Pro, reviewer, QBank editor/owner, access manager/moderator, and MFA-verified Superadmin. Negative counterparts are included for key actions.

Browser smoke evidence:

- Desktop unauthenticated protected route displayed the login boundary without private content.
- 390×844 iPhone-class viewport rendered without horizontal overflow; manifest, theme color and `viewport-fit=cover` were present; no console errors were captured.
- A tablet-size override was attempted, but the in-app browser clamped the viewport; iPad is therefore not claimed verified.
- Installed standalone PWA authentication was not available in this environment.

Network impact: no new recurring request was introduced. Media authorization adds D1 authorization reads only when protected R2 media is requested. Unknown-account login deliberately performs one PBKDF2 operation. Backup HMAC is paid only during export/restore. Response headers add no request. Before/after production traffic was not measurable locally.

Known build warning: one client chunk is larger than 500 kB after minification. This is a performance follow-up, not a failed security control.
