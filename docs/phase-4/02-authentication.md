# Authentication and session security

## Flow

1. Registration/login is handled in `lib/cloudflare-server.ts`; passwords use Worker-compatible PBKDF2.
2. The server creates a random opaque session, stores only its hash in D1, and returns a `__Host-` cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`.
3. `currentUser` in `features/auth/server/auth-service.ts` hashes the presented token and reloads the profile/session from D1 for each protected request.
4. Logout deletes the server session and clears the cookie. Password change revokes other sessions.
5. The singleton Superadmin must complete TOTP MFA. Successful verification now creates a fresh verified session and deletes the temporary one.

## Hardening completed

- Unknown-email login performs the same PBKDF2 work before returning the generic 401 response, reducing account/timing enumeration.
- Initial root bootstrap session is unverified and limited to five minutes; it can access only session discovery and MFA enrollment/completion, not protected APIs. Ordinary approved sessions retain the existing seven-day lifetime.
- MFA enrollment and login verification rotate the session token and revoke the predecessor.
- Client-supplied identity, role, plan, and reviewer fields are not proof of authority.
- Mutating cookie-authenticated requests use same-origin validation.

## Session assessment

| Control | Result |
|---|---|
| Random opaque token; hashed at rest | Verified in code/tests |
| HttpOnly/Secure/SameSite | Verified in cookie construction |
| Expiration and server lookup | Verified |
| Logout invalidation | Verified |
| MFA fixation resistance | Fixed and tested |
| Superadmin pre-enrollment privilege | Denied and tested |
| Role/plan reevaluation on next request | Verified |
| Account switch cache clearing | Existing regression coverage; no new browser credential test |
| Password reset/recovery | Not found |
| MFA recovery codes | Not found |

No credentials, real accounts, or production sessions were used in Phase 4.
