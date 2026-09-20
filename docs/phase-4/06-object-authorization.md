# Object authorization / IDOR-BOLA review

## Reviewed object classes

| Object | Identity source | Read scope | Mutation scope | Negative evidence |
|---|---|---|---|---|
| Profile/personal record | Session `uid` | Self | Self and field allowlist | Cross-owner backup collision denied |
| QBank | D1 owner/membership/public flags | Public or membership | Owner/editor by exact action | Non-owner management tests |
| Question | Parent QBank and question ID | QBank access | Owner/editor or proposal path | Changed QBank/question IDs rejected |
| Exam/checkpoint | Session `uid` | Self | Self, version checked | Stale/invalid checkpoint tests |
| Flashcard/deck/note | Session `uid` and parent IDs | Self | Self, structural constraints | Cross-user/malformed state tests |
| Proposal/review | Target QBank + server reviewer | Authorized queue | Valid unresolved transition | Duplicate/two-review tests |
| Ticket/report | Reporter/privileged queue | Scoped | Owner/authorized reviewer | Privacy/deletion tests |
| Ready-made test | Owner, status, visibility, version | Published/public or participant policy | Owner/moderator | Leaderboard/media denial tests |
| R2 media | Metadata `qbank_id`/scope | Resource policy | Owner/editor/authorized delete | Private media attempt tests |

## Fixed BOLA paths

- Personal backup restore no longer accepts unsigned IDs or overwrites an existing record owned by another user.
- Ready-made-test leaderboard no longer returns draft/private results merely from a known test ID.
- Private ready-made-test R2 media is no longer authorized from `published` status alone.

Sensitive queries use bound parameters. Restore upserts also include ownership conditions so a preflight race cannot silently cross owners. No dynamic SQL built from untrusted field values was found in the reviewed paths.
