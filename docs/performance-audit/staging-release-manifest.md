# Qraft staging release manifest

The release candidate is the commit immediately before the post-deployment evidence commit, avoiding a Git commit that attempts to contain its own hash.

| Field | Value |
|---|---|
| Candidate SHA | `68a97cc9cfd478846a469bb7056a2da37bc17b10` |
| Build version | Git SHA injected as `x-qraft-build` |
| Build timestamp | `2026-09-24T16:45:01.748Z` |
| Node / npm | Node `v22.14.0`; npm `10.9.2` |
| Wrangler | `4.135.0` from lockfile |
| Compatibility date | `2026-09-09` |
| Migration set | `0000`–`0020` |
| Staging app Worker | `qraft-staging` |
| Staging realtime Worker | `qraft-realtime-staging` |
| Staging D1 | `qraft-qbank-staging` / `f788be6b-f763-49e8-840b-4c107c7e5874` |
| Staging R2 | `qraft-assets-staging` |
| App version ID | `fa427ae6-7c7e-4274-98dd-1935c20e5ad0` |
| Realtime version ID | `c44eac2b-aaf5-4b78-8315-91274c6697a8` |
| Hostname | `https://qraft-staging.eduhelp.workers.dev` |
| Realtime hostname | `https://qraft-realtime-staging.eduhelp.workers.dev` |
| Migration state | `0000`–`0020` applied; no pending migrations |
| Previous app version | `77b9aa6f-ea44-49c9-ab7f-7e749859f457` |
| Previous realtime version | `1910720b-b0b4-45d6-ba77-4bba51cbd197` |

The initial inventory contained no staging Workers. After the first deployment exposed a seed-fixture defect, the corrected candidate was rebuilt, retested and redeployed. The immediately previous Worker versions shown above are the precise rollback point. Deleting both staging Workers remains the full-disable path. Production Workers and storage are outside both procedures.

## Phase 11B reconciliation (2026-09-27)

RC1 evidence above is historical. The intended website is now reconciled on `audit/rc2-final-website`, with PWA v4.4.1, current branding/product flows, Phase 10 safeguards and required migrations 0021–0023. The new detached proof, deployed identity and smoke results will be appended after verification. Do not reuse RC1 measurements as RC2 evidence or automatically run the full Phase 11 matrix.
