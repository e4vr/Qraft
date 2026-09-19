# Roles and permission matrix

## Role model

Qraft has three overlapping role systems:

1. `UserRole`: `student`, `reviewer`, `access_manager`, `admin`, `super_admin`.
2. `platformRoles[]`: `moderator`, `reviewer`, `access_manager`.
3. Per-QBank membership role: `editor`, `reviewer`, `viewer`; owner is represented by `qbank.ownerId`.

The helper hierarchy is significant:

- `hasModeratorRole`: superadmin, legacy admin, or platform moderator.
- `hasReviewerRole`: moderator, legacy reviewer, or platform reviewer.
- `hasAccessManagerRole`: moderator, legacy access manager, or platform access manager.
- Client `user.isAdmin` is derived from `hasAccessManagerRole`, not simply from the legacy role name.

Roles are stored in profile JSON and QBank membership records. Platform roles are managed by moderators; access managers can alter account approval/suspension fields. Superadmin profiles are protected from the general profile mutation path.

## Role → permission matrix

Legend: **Y** server-authorized, **Scoped** only own/member bank, **—** denied, **Root** superadmin + verified MFA for the sensitive action.

| Capability | Student | QBank owner | Bank editor | Bank reviewer | Platform reviewer | Moderator / legacy Admin | Access manager | Superadmin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Use public/member QBanks | Y | Y | Y | Y | Y | Y | Y | Y |
| Create QBank | plan-gated | plan-gated | plan-gated | plan-gated | plan-gated | plan-gated | plan-gated | Y |
| Manage bank settings/share/members | — | Scoped | — | — | — | — unless owner | — unless owner | Y |
| Edit bank questions/classification | contribution/proposal only | Scoped | Scoped | — | review only | review or ownership | ownership only | Y |
| Review proposals | — | Scoped | Scoped | Scoped | Y | Y | — unless another role | Y |
| Delete non-essential bank | — | Scoped | — | — | — | ownership only | ownership only | Y |
| Manage essential/SMLE bank | — | — | — | — | review path | — | — | Root |
| View own contact tickets | Y | Y | Y | Y | Y | Y | Y | Y |
| View/manage all tickets | — | — | — | — | — | — | — | Root |
| Approve/suspend accounts | — | — | — | — | — | Y via moderator hierarchy | Y | Root |
| Assign platform roles | — | — | — | — | — | Y | — unless moderator | Root |
| Manage plans/coupons/economy | — | — | — | — | — | — | — | Root |
| Content/personal backup | personal plan-gated | same | same | same | same | same | same | Root for content backup |
| View audit log | — | — | — | — | — | — | — | Root |
| Moderate preformed reports | — | — | — | — | — | — | — | Root |

## Frontend/backend differences

- The frontend hides/administers tabs using the same broad role concepts, but the final decision for protected operations is in server helpers and record policy.
- `reviewer-performance` requires `user.isAdmin && user.mfaVerified`; a pure reviewer cannot view it despite the feature name. Non-superadmin accounts are treated as MFA-verified after normal session verification, so the MFA predicate has little additional effect for them.
- A bank editor can edit content and classification but cannot change owner/share/member fields. Bank reviewers can decide proposals but cannot edit ordinary bank records.
- `loadCollaboration` filters inaccessible banks and hides audit/security/admin data. An access manager who is not superadmin receives redacted member fields and no phone numbers.

## Final authorization location

| Operation | Classification |
| --- | --- |
| Authenticated session/account status | Server enforced |
| Platform role and account administration | Both; final server decision |
| QBank read/manage/edit/review/ownership | Both; final server decision |
| Plan limits for core creates/import/exams/media/flashcards | Both, plus selected D1 triggers |
| Navigation/tab visibility | Client enforced only (presentation, not security) |
| Audit-log record contents | Server check exists but is insufficient; see RISK-AUTH-001 |

