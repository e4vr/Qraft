# Qraft Collaborative QBank

Qraft is a private, installable collaborative QBank PWA. The initial **SMLE
General Surgery** bank contains 217 questions imported from
`MedGard - GS first 51.pdf`; answer keys are preserved and extraction artifacts
are corrected without changing the source meaning.

## Product capabilities

- Public and private QBanks created from scratch by Pro users, with Bank Owner,
  Reviewer, and Viewer access per bank.
- Private-bank invitations by email and revocable access links. Private content
  remains visible to the Superadmin for audit but is not directly editable there.
- Tutor/Timed tests, persistent removable marker highlights, answer-choice
  statistics, keyboard shortcuts, daily goals, and a full dark mode.
- Classified edit proposals with required explanation and source, plus a
  field-by-field before/after review screen.
- Shared notes and images editable by approved members, with editor name,
  timestamp, version history, and audit attribution.
- First-registration approval before any QBank access.
- One-time university ID claiming from an administrator-managed eligibility list.
- A single MFA-protected Superadmin, synchronized role applications, and a
  least-privilege administration workspace.
- Printable per-QBank PDF export with answers and attributed shared explanations.
- IndexedDB offline cache, Cloudflare D1/R2 synchronization, and an iPad-ready PWA.

## Permission model

- Account tiers are `lite` and `pro`. Lite users study public/shared banks; Pro
  users can create and own banks.
- `super_admin`: exactly one UID recorded in `system/security`. It can audit all
  banks and approve platform roles, but cannot directly modify another owner's
  private bank or approve its edits unless that owner grants Reviewer access.
- `access_manager`: registration approval, blocking/restoring accounts, and
  university-ID administration only. Its ordinary study tier behaves as Pro.
- `reviewer`: reviews public-bank changes. A private bank requires a separate
  per-bank Reviewer grant from its owner.
- Per-bank `owner`, `reviewer`, and `viewer` grants are independent of the user's
  platform roles.
- `pending` or `rejected` accounts cannot read QBank data or save progress.

The interface is not the security boundary. The authenticated Cloudflare Worker
API independently enforces approval, roles, single-use student IDs, Essential
QBank ownership, proposal review, note attribution/versioning, and image limits.

## Run locally

1. Copy `.dev.vars.example` to `.dev.vars` and replace both sample values. Use
   the intended Superadmin email and a long, random one-time setup code.
2. Install dependencies and initialize the local D1 database:

   ```bash
   npm install
   npm run db:migrate:local
   npm run dev
   ```

3. Open `http://localhost:3000` and create the first Superadmin account with the
   configured email and setup code. The former root-admin demo entry no longer
   exists.
4. Enroll the Superadmin in authenticator-app MFA, optionally import known university
   IDs, then approve student registrations from the administration workspace.

Progress is cached locally for offline resilience, while authenticated shared
data is stored in D1 and uploaded images are stored in R2.

## Configure Cloudflare

1. Let the Cloudflare deployment flow provision the configured D1 database and
   R2 bucket, or create them beforehand using the names `qraft-qbank` and
   `qraft-qbank-media`.
2. Add `ROOT_ADMIN_EMAIL` and `ROOT_ADMIN_SETUP_TOKEN` as Worker secrets. Never
   commit their real values.
3. Apply the `drizzle/` migrations to the remote D1 database.
4. Run `npm run build` and `npm run cloudflare:check` before deployment.

## Validation

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Tests cover the 217-question source integrity, PWA files, singleton Superadmin,
private-bank isolation, per-bank roles, single-use university IDs, classified
edit review, marker behavior, answer statistics, dark mode, and shared notes.
