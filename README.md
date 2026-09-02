# MedGuard SMLE QBank

MedGuard is a private, installable SMLE question-bank PWA. Phase one contains
217 Surgery questions imported from `MedGard - GS first 51.pdf`, with the answer
key preserved and the PDF text-layer artifacts corrected.

## Included

- Email/password and Google sign-in when Firebase is configured.
- IndexedDB offline persistence with automatic Firestore synchronization.
- Tutor and Timed tests, status filters, Specialty and Topic filters.
- Resume-safe test sessions, question navigator, results, and progress views.
- Per-user flags, yellow text highlights, notes, and note images.
- Error reports, direct admin corrections, and an answer revision log.
- Printable PDF export containing questions, answers, notes, and images.
- JSON backups, manual question entry, a daily goal, and a manual Sync button.
- Installable iPad/desktop PWA shell and offline asset cache.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Demo mode works without cloud credentials and
saves its test state in IndexedDB on the current device.

## Connect Firebase

1. Create a Firebase project and a Web app.
2. Enable Email/Password and Google in Firebase Authentication.
3. Create a Firestore database and a Cloud Storage bucket.
4. Copy `.env.example` to `.env.local` and fill the `NEXT_PUBLIC_FIREBASE_*`
   values. Set `NEXT_PUBLIC_ADMIN_EMAIL` to the owner account.
5. Deploy `firestore.rules` and `storage.rules` to the Firebase project.
6. Restart the app. Demo mode disappears and real account sync becomes active.

Firebase web configuration values identify the project but do not replace the
included Firestore and Storage rules. Each signed-in user can access only their
own progress and note images.

## Validation

```bash
npm test
npm run lint
npm run build
```

The data-integrity tests require exactly 217 questions, four non-empty options
per question, a valid A-D answer mapping, page-order preservation, removal of
known PDF font-encoding artifacts, and the expected PWA/security files.
