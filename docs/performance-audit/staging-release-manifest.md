# Qraft staging release manifest

This file is completed after the clean-checkout gate and staging deployment. The release candidate is the commit immediately before the post-deployment evidence commit, avoiding a Git commit that attempts to contain its own hash.

| Field | Value |
|---|---|
| Candidate SHA | Pending clean-checkout gate |
| Build version | Git SHA injected as `x-qraft-build` |
| Build timestamp | UTC timestamp injected as `x-qraft-build-time` |
| Node / npm | Pending gate capture |
| Wrangler | `4.135.0` from lockfile |
| Compatibility date | `2026-09-09` |
| Migration set | `0000`–`0020` |
| Staging app Worker | `qraft-staging` |
| Staging realtime Worker | `qraft-realtime-staging` |
| Staging D1 | `qraft-qbank-staging` / `f788be6b-f763-49e8-840b-4c107c7e5874` |
| Staging R2 | `qraft-assets-staging` |
| App version ID | Pending deployment |
| Realtime version ID | Pending deployment |
| Hostname | Pending deployment |
| Migration state | Empty resource; pending reviewed apply |
| Previous app version | None observed before first deployment |
| Previous realtime version | None observed before first deployment |

The pre-deployment inventory contained no staging Workers. The safe first-release rollback point is therefore “no staging Worker”: delete `qraft-staging` and `qraft-realtime-staging`. Production Workers and storage are outside this rollback path.
