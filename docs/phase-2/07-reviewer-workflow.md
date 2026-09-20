# Reviewer Workflow Audit

## Verified behavior

- Queue visibility is scoped by platform reviewer capability or bank reviewer/owner/editor capability.
- A proposal author cannot be the independent reviewer.
- Source and complete question payload are required.
- High-risk answer/medical-content changes require two independent reviewers.
- The final shared question must byte-logically match the reviewed proposal fields.
- Concurrent/stale decisions are guarded by pending-status conditions, unique review identity and batch atomicity.
- Completion credits are claimed once; aggregation handles current and legacy completion without double counting.
- Bulk actions cap at 200 and roll back as a unit.

## Suggest Edit and reports

- Suggestions follow pending → approved/rejected transitions and cannot directly overwrite shared content.
- Question-linked tickets preserve historical meaning after a question is deleted/reused.
- Ready-made-test reports require a published public test and are unique per reporter/test.

## Remaining boundary

Deep authorization abuse testing, forged audit content and leaderboard privacy belong to Phase 3. No exploit claim is made here.
