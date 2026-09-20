# Server authorization matrix

Roles combine rather than form one hierarchy: subscription plan, platform role, and QBank relationship are separate axes. `Admin` below refers to the legacy/admin-compatible privileged path actually present; Superadmin is the singleton `super_admin` plus verified MFA.

| Operation | User | QBank owner/editor | Reviewer | Access manager/admin | Superadmin |
|---|---:|---:|---:|---:|---:|
| Read accessible/public QBank | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Read unrelated private QBank | DENY | DENY | DENY | DENY | Explicit privileged path only |
| Edit owned QBank content | DENY | ALLOW | Relationship-dependent | Relationship-dependent | ALLOW |
| Manage QBank membership/share/delete | DENY | Owner only | DENY unless owner | DENY unless owner | ALLOW |
| Submit suggestion/report | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| Decide ordinary review proposal | DENY | Only with reviewer authority | ALLOW | Moderator/admin-compatible | ALLOW |
| Assign reviewer/access-manager role | DENY | DENY | DENY | Limited configured scope | ALLOW + MFA |
| Activate/override a plan | DENY | DENY | DENY | DENY | ALLOW + MFA |
| Create/manage coupons | DENY | DENY | DENY | DENY | ALLOW + MFA |
| Manage registration/access queue | DENY | DENY | DENY | Access manager ALLOW | ALLOW + MFA |
| Edit Essential QBank directly | Proposal only | Proposal only | Proposal only | Proposal only | ALLOW + MFA |
| Delete own account | ALLOW | ALLOW | ALLOW | ALLOW | Existing protected policy |

Reviewer, QBank owner, and Pro are not administrator inheritance paths. Tests cover normal user → reviewer denial, reviewer → Superadmin denial, editor versus owner boundaries, and platform role independence from subscriptions.
