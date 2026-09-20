# Confirmed security findings

All reproduction was local against isolated fixtures. No production data or live service was attacked.

## SEC-401 — Critical — Personal backup cross-owner overwrite

- **Component:** `lib/platform-server.ts`, personal backup restore.
- **Preconditions:** Approved authenticated user and a crafted/modified backup containing known record IDs.
- **Finding/impact:** Unsigned input and unconditional upsert could replace records owned by another account, causing cross-user data integrity loss.
- **Root cause:** Backup authenticity and target-owner collision were not verified.
- **Fix:** HMAC-SHA256 signature, owner/export-date binding, strict ID/shape checks, collision preflight, and ownership-scoped upsert.
- **Verification:** Unsigned/tampered/cross-owner restore is denied; correctly signed self restore succeeds.

## SEC-402 — High — Client-forged audit records

- **Component:** `lib/cloudflare-server.ts`, collaboration writes.
- **Preconditions:** Approved authenticated user able to submit collaboration operations.
- **Finding/impact:** A client could write an `auditLog` collection record and forge actor/action evidence.
- **Root cause:** Audit collection was accepted as ordinary collaboration state.
- **Fix:** All client `auditLog` writes are denied; server workflows author audit events.
- **Verification:** Direct forged write returns denial and no record persists.

## SEC-403 — High — Ready-test leaderboard object authorization

- **Component:** `lib/preformed-test-server.ts` leaderboard action.
- **Preconditions:** Approved user knows another test ID.
- **Finding/impact:** Draft/private leaderboard data could be read without ownership or participation.
- **Fix:** Non-owner must be authenticated current-version participant and test must be published.
- **Verification:** Unrelated user denied; owner and participant allowed.

## SEC-404 — High — Private ready-test media exposure

- **Component:** `lib/cloudflare-server.ts` media serving.
- **Preconditions:** Attacker obtains/guesses a media key for a published private test.
- **Finding/impact:** Status alone authorized the R2 object.
- **Fix:** Resolve visibility/version and require owner, public publication, current participant, or scoped attempt token.
- **Verification:** Draft/unrelated reads denied; owner and valid attempt URL allowed.

## SEC-405 — High — MFA session fixation window

- **Component:** MFA completion/verification.
- **Preconditions:** Possession of the temporary root session token.
- **Finding/impact:** The same token became fully verified after MFA rather than being replaced.
- **Fix:** Atomically create a fresh verified token and delete the temporary session.
- **Verification:** Cookie changes; old token fails; new token succeeds.

## SEC-406 — Medium — Unknown-login timing distinction

Unknown accounts skipped PBKDF2. A fixed dummy PBKDF2 path now precedes the same generic 401 response.

## SEC-407 — Medium — Long root bootstrap session

Initial Superadmin registration received the ordinary seven-day session. It is now five minutes pending MFA.

## SEC-408 — Medium — CSV formula injection

Ready-test CSV fields could start spreadsheet formulas. Dangerous prefixes are now escaped before export.

## SEC-409 — Medium — Missing central production headers

The Worker lacked one consistent security-header boundary. A central wrapper now applies the documented headers while preserving 101 upgrades.

## SEC-410 — Medium — High-severity development dependency advisories

Cloudflare tooling was updated (`wrangler` 4.135.0, Vite plugin 1.54.7), eliminating high advisories. Four moderate development-only advisories remain in the Drizzle/esbuild toolchain; production dependencies report zero.

## SEC-411 — Critical — Superadmin access before MFA enrollment

- **Component:** registration/login session creation and MFA enrollment endpoints.
- **Preconditions:** The singleton Superadmin account had been created but TOTP enrollment was not complete.
- **Finding/impact:** The setup session was marked verified, and a password login with no enrolled TOTP also became verified; protected Superadmin APIs could therefore be reached before the required second factor existed.
- **Root cause:** Session verification represented login completion but was not separated from MFA enrollment state.
- **Fix:** Root setup/login sessions are unverified and five minutes long. Only session discovery and guarded enrollment/completion accept them. Existing-TOTP sessions cannot replace MFA before verifying the current factor.
- **Verification:** Pre-enrollment session reports `mfaVerified=false`, a direct Superadmin discounts request is denied, enrollment is allowed, and the completed flow rotates the token.
