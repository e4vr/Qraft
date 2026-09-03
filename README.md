# MedGuard Collaborative QBank

MedGuard is a private, installable collaborative QBank PWA. The initial **SMLE
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
- IndexedDB offline support, Firebase synchronization, and an iPad-ready PWA.

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

The interface is not the security boundary. `firestore.rules` and
`storage.rules` independently enforce approval, roles, single-use student IDs,
proposal review, note attribution, note version increments, and image limits.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The root-admin demo stores its personal and shared
workspace state in IndexedDB on the current device. It is intended for product
testing only.

## Connect Firebase

1. Create a Firebase project and Web app.
2. Upgrade Firebase Authentication with Identity Platform, enable
   **Email/Password**, email verification, and **TOTP MFA**.
3. Create Firestore and Cloud Storage.
4. Copy `.env.example` to `.env.local`, fill the Firebase values, and set
   `NEXT_PUBLIC_ADMIN_EMAIL` to the owner email.
5. Create the owner in Firebase Authentication. Copy its `uid`, then create
   `profiles/{uid}` in Firestore with these fields:
   - `uid`: the same Authentication UID
   - `email`: owner email
   - `displayName`: owner name
   - `universityId`: `ADMIN`
   - `role`: `super_admin`
   - `tier`: `pro`
   - `platformRoles`: `[]`
   - `status`: `approved`
   - `createdAt`: an ISO timestamp
6. Create `system/security` with `superAdminUid` set to that exact UID and
   `updatedAt` set to an ISO timestamp. Rules prevent changing the root UID or
   creating a second Superadmin.
7. Create the public `qbanks/smle-gs` metadata document using the fields in
   `initialCollaborationState()`.
8. Deploy `firestore.rules` and `storage.rules`.
9. Sign in as the Superadmin, verify the email, complete authenticator-app MFA,
   import the permitted university IDs, then students
   can submit registration requests. Each student ID can be claimed only once.

Do not put Firebase service-account credentials in this project. Firebase Web
configuration values are public identifiers; authorization is enforced by the
included server-side rules.

## Validation

```bash
npm test
npm run lint
npm run build
```

Tests cover the 217-question source integrity, PWA files, singleton Superadmin,
private-bank isolation, per-bank roles, single-use university IDs, classified
edit review, marker behavior, answer statistics, dark mode, and shared notes.
