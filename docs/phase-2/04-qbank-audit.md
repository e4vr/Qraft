# QBank Lifecycle Audit

## Creation and visibility

- Pro/Unlimited creation and private-bank gates remain enforced by server plan limits.
- Owner, creator, visibility, share flags and essential-bank status are stored on the QBank record.
- Essential-bank mutation remains root-only.

## Membership and sharing

- Share links are possession grants only while the server record is enabled and matches the bank.
- Link joins use deterministic membership identity and are idempotent.
- Owner/editor/reviewer/viewer capabilities continue to use canonical access policy.
- Phase 2 prevents two records from granting contradictory roles to the same user in one bank.

## Deletion

- QBank deletion is hard deletion for the bank and its scoped collaborative records.
- Question-delete triggers retire question identity and scrub personal-state references.
- Classification revisions/operation history are deleted with the bank.
- Audit records remain as historical evidence and are not QBank-scoped children.
- R2 deletion is a separate external operation and cannot share a D1 transaction; see P2-U02.

## CRUD result

Create/read/update/delete, role boundaries, link join, member removal, folder cascade, and direct-delete cascade are covered by Miniflare integration tests. Recreate is allowed only with new question UUIDs; retired question identity is not silently resurrected.
