# Qraft staging data policy

The Phase 11A environment uses only generated identities and content. It must not receive production exports, production cookies or tokens, real user email addresses, identifiable user content, or private production question-bank data.

The deterministic seed creates three accounts under the reserved `.invalid` domain, one public bank, one private bank, two collaboration memberships, three questions, one pending review proposal, and one in-progress exam. Two questions are intentionally similar so the existing duplicate detector can be exercised. Re-running the seed updates those fixed records and does not create additional accounts or content.

The account password is generated locally in `.dev.vars.staging`, which Git ignores. The same password applies to the three test accounts:

- `owner@staging.qraft.invalid`
- `reviewer@staging.qraft.invalid`
- `student@staging.qraft.invalid`

Operators must not replace these with real addresses or reuse any production credential. The seed script validates the checked-in staging binding and refuses to run if its target name or ID equals the known production D1 resource.

The staging bucket starts empty. Smoke validation may upload generated fixtures only. Delete test uploads after a validation cycle when they are no longer needed.
