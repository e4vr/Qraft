# Security test matrix

`ALLOW` means a server-authorized path exists for that exact relationship; it is not implied by UI visibility.

| Endpoint/action | Anonymous | Lite/Pro user | Reviewer | QBank owner | Superadmin |
|---|---:|---:|---:|---:|---:|
| Login/register | ALLOW | N/A | N/A | N/A | Bootstrap policy |
| Read own personal state | DENY | ALLOW | ALLOW | ALLOW | ALLOW |
| Read another user's personal state | DENY | DENY | DENY | DENY | No general implicit allow |
| Restore unsigned/cross-owner backup | DENY | DENY | DENY | DENY | DENY |
| Read public QBank | Public policy | ALLOW | ALLOW | ALLOW | ALLOW |
| Read unrelated private QBank | DENY | DENY | DENY | DENY | Explicit privileged workflow only |
| Edit/manage QBank | DENY | DENY | Relationship only | ALLOW | ALLOW |
| Manage membership/delete QBank | DENY | DENY | DENY unless owner | Owner ALLOW | ALLOW |
| Submit proposal/report | Auth required | ALLOW | ALLOW | ALLOW | ALLOW |
| Decide review | DENY | DENY | ALLOW | Only if reviewer too | ALLOW |
| Assign platform role | DENY | DENY | DENY | DENY | ALLOW + MFA |
| Activate plan/coupon admin | DENY | DENY | DENY | DENY | ALLOW + MFA |
| Protected API before Superadmin MFA enrollment | DENY | N/A | N/A | N/A | DENY; enrollment endpoints only |
| Ready-test draft leaderboard | DENY | DENY | DENY | Test owner ALLOW | Moderation policy |
| Ready-test published leaderboard | DENY | Participant ALLOW | Participant ALLOW | Test owner ALLOW | Moderation policy |
| Private ready-test media | Valid attempt only | Participant/attempt | Participant/attempt | Test owner ALLOW | Resource policy |
| Forge audit record | DENY | DENY | DENY | DENY | Client path DENY |

## Negative request dimensions

Integration tests exercise missing/wrong authentication, wrong role, wrong plan, wrong relationship, changed IDs, stale versions, malformed/extra fields, expired entitlement, replay/duplicate operations, and boundary limits. High-value Phase 4 cases were first observed failing locally, then repaired, then run through the full suite.

## Entitlement test matrix

| Capability | Lite/Free | Pro | Server check | UI check | Automated test |
|---|---:|---:|---:|---:|---:|
| Free lifetime exam allowance | Limited | N/A | Yes | Yes | Yes |
| Pro monthly exam starts | N/A | 250 | Yes | Yes | Yes |
| Lite saved-state limits | Limited | Higher | Yes | Yes | Yes |
| Earn/redeem contribution rewards | Allow per rules | Allow | Yes | Yes | Yes |
| Expired subscription fallback | Downgrade | Downgrade | Yes | Refresh/display | Yes |
| Reviewer/Superadmin capability | Never from plan | Never from plan | Yes | Yes | Yes |
