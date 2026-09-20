# Superadmin security

Qraft has a singleton `super_admin` boundary. High-risk operations require an approved authenticated account, the exact role, and verified TOTP MFA. Root bootstrap requires the configured email and setup token; its initial session is unverified, limited to five minutes, and restricted to MFA enrollment/completion. A password login before enrollment receives the same restricted setup state rather than privileged access.

## Privileged operations reviewed

- Assign/remove platform roles and registration access.
- Activate/override subscription plans and expiry.
- Create/manage coupons and inspect their usage.
- Directly manage Essential QBanks and global QBank folders.
- Moderate ready-made tests/reports.
- Perform privileged destructive or account-governance actions defined by existing policy.

Each operation validates the target and allowed values on the server, writes authoritative D1 state, and emits server-authored audit events where the workflow supports them. A hidden route/button is not a control.

Phase 4 fixed both the pre-enrollment bypass and MFA session fixation: setup sessions cannot call protected APIs; enrollment completion and login verification create a new random verified session and delete the temporary session atomically. The old token fails immediately in regression tests.

Remaining controls: no MFA recovery-code workflow was found; production access monitoring and Cloudflare account protections were not available for review; audit records are attributable but not cryptographically append-only.
