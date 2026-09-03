# MedGuard Collaborative QBank

MedGuard is a private, installable collaborative QBank PWA. The initial **SMLE
General Surgery** bank contains 217 questions imported from
`MedGard - GS first 51.pdf`; answer keys are preserved and extraction artifacts
are corrected without changing the source meaning.

## Product capabilities

- Multiple isolated QBanks (SMLE, USMLE, university courses, and future banks).
- Personal Tutor/Timed tests, progress, flags, highlights, and daily goals.
- Student question and correction proposals with a mandatory admin review queue.
- Shared notes and images editable by approved members, with editor name,
  timestamp, version history, and audit attribution.
- First-registration approval before any QBank access.
- One-time university ID claiming from an administrator-managed eligibility list.
- Root-admin-only administrator promotion, plus a synchronized admin workspace.
- Admin registration, QBank, proposal, student-ID, administrator, and audit views.
- Printable per-QBank PDF export with answers and attributed shared explanations.
- IndexedDB offline support, Firebase synchronization, and an iPad-ready PWA.

## Permission model

- `super_admin`: manages admins and has every admin permission.
- `admin`: approves or rejects registrations and question changes, imports
  eligible student IDs, and creates QBanks.
- `student`: uses approved QBanks, proposes questions/corrections, and edits
  shared notes directly.
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
2. Enable **Email/Password** in Firebase Authentication.
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
   - `status`: `approved`
   - `createdAt`: an ISO timestamp
6. Deploy `firestore.rules` and `storage.rules`.
7. Sign in as the root admin, import the permitted university IDs, then students
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

Tests cover the 217-question source integrity, PWA files, collaborative role
rules, single-use university IDs, admin-only question publication, and
attributed shared-note versioning.
