# QRAFT ENGINEERING CONSTITUTION
# Permanent Architecture, Backend, Data, Realtime and Frontend Integration Rules

Status: AUTHORITATIVE ENGINEERING POLICY

This document defines the permanent engineering principles of Qraft.

Every feature, refactor, optimization, migration, backend endpoint,
database query, realtime event, frontend data flow and release decision
must comply with this constitution.

This document is NOT a temporary optimization prompt.

It defines how Qraft should be engineered as the product grows.

==================================================
0. ENGINEERING MISSION
==================================================

Qraft is a collaborative medical QBank platform containing multiple independent
question banks, exams, Ready/Preformed Tests, flashcards, review workflows,
user progress, imports, realtime collaboration and administrative monitoring.

The architecture must optimize for:

1. Data correctness
2. Security and authorization
3. User data durability
4. Reliability
5. Fast perceived user experience
6. Efficient database access
7. Minimal unnecessary network work
8. Predictable scaling
9. Maintainability
10. Low reasonable infrastructure cost

IN THAT ORDER.

Never optimize cost at the expense of correctness.

Never optimize benchmark numbers at the expense of user experience.

Never increase infrastructure capacity to hide an obviously inefficient design.

The target is:

THE MINIMUM NECESSARY NETWORK, DATABASE AND CPU WORK
REQUIRED TO PROVIDE A CORRECT, CURRENT, RELIABLE AND FAST EXPERIENCE.

==================================================
1. PRODUCT BEHAVIOR IS A CONTRACT
==================================================

The current intended Qraft frontend and product behavior are part of the
engineering contract.

Backend work must preserve currently supported functionality unless a change is
explicitly approved.

Before modifying architecture, inventory the actual current frontend routes,
components, actions and data dependencies.

Do NOT assume an outdated documentation file represents current behavior when
the current intended application implements newer functionality.

If documentation, backend behavior and frontend behavior conflict:

1. identify the conflict;
2. determine the intended current product behavior;
3. preserve data/security invariants;
4. document the decision;
5. do not silently remove functionality.

Frontend and backend must evolve together.

==================================================
2. CURRENT FEATURE CONTRACT
==================================================

The architecture must support Qraft's existing product model, including where
currently implemented:

- multiple Public and Private QBanks;
- question browsing and answering;
- custom exams;
- Ready / Preformed Tests;
- user progress;
- question statistics;
- flags;
- bookmarks;
- flashcards;
- Daily Goal;
- private notes where supported;
- exam review;
- question navigator;
- question marking;
- explanations;
- labs/tools panels where supported;
- collaboration;
- Suggest Edit / reports;
- reviewer workflows;
- duplicate review;
- JSON/import workflows;
- import progress/monitoring;
- specialties/topics;
- user-created private banks;
- bank sharing;
- account/package enforcement;
- Superadmin;
- Reviewer permissions;
- PWA behavior;
- desktop, tablet and iPhone layouts;
- current navigation structure;
- realtime updates;
- dark/light preferences where persisted.

No backend refactor may accidentally disable one of these frontend capabilities.

==================================================
3. THREE-LAYER ARCHITECTURE
==================================================

Qraft should conceptually consist of three layers:

A. APPLICATION DATA

Examples:

Users
QBanks
Questions
Ready Tests
Exam Sessions
User Question State
Progress
Flashcards
Review Items
Import Jobs
Topics
Specialties

B. OPERATIONAL INTELLIGENCE

Examples:

usage metrics
Worker metrics
D1 metrics
performance monitoring
cost monitoring
query health
anomaly detection

C. PROTECTION LAYER

Examples:

authorization
Fair Use
rate protection
idempotency
batch limits
abuse detection
audit trails
concurrency controls

Do not mix these layers unnecessarily.

In particular:

D1 application tables must not become a click-by-click telemetry log.

==================================================
4. DATA MODEL — ENTITY OWNERSHIP
==================================================

Core entities must remain logically independent.

At minimum the architecture must clearly distinguish:

User
QBank
Question
Ready/Preformed Test
Exam Session
Flashcard
User Question State
Review Item
Import Job
Topic
Specialty

Do not store large unrelated aggregates in a single generic record merely because
it is convenient.

Every entity must have:

- a clear owner;
- an authoritative source;
- a lifecycle;
- access rules;
- deletion behavior;
- audit requirements where appropriate.

Avoid unnecessary duplication of authoritative data.

==================================================
5. QBANK ISOLATION
==================================================

QBank is a primary data boundary.

Questions should be scoped by bank whenever logically appropriate.

Operations on one bank should not read unrelated banks without a real business
requirement.

Examples:

Opening General Surgery
must not scan Pediatrics.

Duplicate detection in one private QBank
must not scan every public bank.

Reviewing one bank
must not load unrelated collaboration data.

Bank isolation must exist in backend query logic and authorization.

It must NOT be only a frontend filter.

==================================================
6. QUESTION MODEL
==================================================

A Question is an authoritative content entity.

User-specific behavior must NOT mutate the question record itself.

Question content and user state must remain separate.

User-specific properties such as:

answered
correct
incorrect
flagged
bookmarked
selected answer
personal progress

belong to the relationship:

user_id + question_id

not to the Question entity.

This allows many users to interact with one canonical question safely.

==================================================
7. FLAGS AND BOOKMARKS
==================================================

Flag and Bookmark are independent user states.

A question may be:

flagged
bookmarked
both
neither

Do not couple their persistence.

Do not require rewriting the question entity to change either.

==================================================
8. READY / PREFORMED TESTS
==================================================

Ready Tests are not live aliases of QBanks.

They are independent published exam entities.

A published Ready Test must have deterministic membership and ordering.

The system must know:

test_id
question membership
order
settings
published state

Changes to the source QBank must not unexpectedly mutate an already-published
Ready Test.

If Ready Tests reference live Question content rather than snapshots, that behavior
must be explicit and consistent.

Never leave this relationship accidental.

==================================================
9. ACTIVE EXAM ARCHITECTURE
==================================================

An active exam is a SESSION, not a sequence of page fetches.

Once the required exam/question data is loaded:

Question 1
→ Question 2
→ Question 10
→ Question 3

must primarily be local navigation.

Normal exam navigation must NOT repeatedly reload the full exam or question set.

Next
Previous
Question navigator
Explanation
Notes
Mark
Flag
Highlight
other supported exam subviews

must not cause unnecessary full-session fetching.

Separate:

NAVIGATION STATE

from:

SERVER PERSISTENCE.

==================================================
10. EXAM DATA DURABILITY
==================================================

Reducing writes must never significantly increase risk of losing a user's exam
answers.

Client/session state may be used to reduce unnecessary writes.

Safe batching/checkpoints may be used.

However critical answer persistence must remain reliable.

Potential persistence points may include:

checkpoint
save
submit
exit
visibility/lifecycle events where justified

according to measured product behavior.

Do not automatically write every visual interaction to D1.

Do not allow an unexpectedly closed browser to lose an unreasonable amount of
user progress.

==================================================
11. IDEMPOTENT EXAM MUTATIONS
==================================================

Replaying the same authoritative exam state must not create duplicate business
effects.

For example:

answer B already persisted
→ answer B replayed
→ no unnecessary state transition

Retries, double clicks or reconnect replay must not create duplicate audit,
statistics or state records beyond what the data contract requires.

==================================================
12. FLASHCARDS
==================================================

Flashcards are user-owned entities.

When derived from a Question, do not unnecessarily duplicate the entire Question
unless a snapshot is required.

The system must explicitly define whether a flashcard is:

LIVE-LINKED

or:

SNAPSHOT-BASED.

Do not leave synchronization behavior implicit.

User-modified flashcard fields belong to the flashcard.

==================================================
13. DAILY GOAL AND PROGRESS
==================================================

Daily Goal is a user preference.

Lifetime Progress is historical application data.

They must remain separate.

Changing today's goal must not rewrite historical progress.

Starting a new day must not delete prior history.

Progress calculations should derive from actual user activity using efficient
queries or safely maintained aggregates where justified.

==================================================
14. REVIEW ARCHITECTURE
==================================================

User contributions that require review must not directly modify authoritative
public content.

Examples:

new question
suggested edit
report
source submission
content correction

should become Review Items.

Review lifecycle must be explicit.

Examples:

pending
approved

pending
needs_edit
resubmitted
approved

pending
rejected

History should remain attributable.

==================================================
15. REVIEW TYPES MUST REMAIN DISTINCT
==================================================

Do not model every review as one undifferentiated list.

At minimum distinguish:

CONTENT REVIEW

from:

DUPLICATE REVIEW.

Duplicate detection is a machine suspicion requiring human review.

A "Duplicated" tag means:

"potential duplicate detected"

not:

"system has definitively decided this question is duplicate."

==================================================
16. DUPLICATE DETECTION
==================================================

Duplicate detection must be BANK-SCOPED whenever the product semantics permit.

Never implement:

new question
×
every question in the entire database.

Use staged filtering.

Preferred conceptual pipeline:

CHEAP EXACT/FINGERPRINT CHECK
↓
CANDIDATE NARROWING
↓
DEEPER SIMILARITY CHECK
↓
HUMAN REVIEW WHEN NECESSARY

Store an appropriate normalized fingerprint when useful.

Queries may use:

bank_id + fingerprint

with appropriate query-driven indexing.

For non-exact duplicates:

retrieve a bounded candidate set before expensive comparisons.

Do not introduce vector databases or embedding infrastructure until measured
evidence proves simpler methods inadequate.

==================================================
17. DUPLICATE SEMANTICS
==================================================

Optimization must never weaken medically meaningful distinctions.

Duplicate detection must protect differences such as:

NOT / EXCEPT
laterality
numbers
decimals
signs
ranges
units
doses
drug names
different correct answers
meaningfully different clinical findings

Optimization may reduce repeated computation.

It may not silently change duplicate meaning.

==================================================
18. DUPLICATE REVIEW
==================================================

No suspected duplicate should be automatically deleted merely because the
algorithm reports similarity.

Human review must support the intended decisions, such as:

Keep Both
Keep Single Copy
Delete Both

according to current product semantics.

Sensitive deletion/merge actions require appropriate auditability.

==================================================
19. IMPORT ARCHITECTURE
==================================================

Import is a backend workflow, not simply:

JSON
→ hundreds of INSERT statements.

The import pipeline should conceptually perform:

schema validation
↓
per-item validation
↓
bank-scoped duplicate detection
↓
classification
↓
controlled persistence
↓
result report

One malformed question must not necessarily fail an entire valid import.

Support PARTIAL SUCCESS.

==================================================
20. IMPORT LIMIT
==================================================

The technical batch limit is:

150 questions per import operation

unless explicitly revised by future policy.

This is an engineering safety boundary, not necessarily a subscription quota.

Large imports should be divided into controlled batches.

Do not allow one user/account to execute uncontrolled expensive import jobs in
parallel.

Use queueing, serialization or bounded concurrency where appropriate.

==================================================
21. IMPORT RESULT MODEL
==================================================

Import results must be understandable without engineering logs.

At minimum distinguish concepts equivalent to:

Imported
Sent to duplicate review
Skipped
Invalid
Failed

Per-item failure must contain a useful reason.

Do not silently discard import candidates.

==================================================
22. REQUEST MANAGEMENT CONSTITUTION
==================================================

Every application request must have a reason.

Valid reasons include:

initial required load
missing data
user mutation
targeted invalidation
realtime synchronization
reconnect recovery
controlled background validation
intentional prefetch

The following are NOT sufficient reasons by themselves:

component mounted
component rendered
route changed
user returned to a page
window gained focus
PWA resumed
unrelated WebSocket event

==================================================
23. REQUEST DECISION HIERARCHY
==================================================

When data is needed, prefer this order:

1. valid local/session/cache state;
2. authoritative cache patch from mutation/realtime event;
3. share an identical in-flight request;
4. fetch one targeted resource;
5. fetch a small related dataset;
6. controlled background revalidation;
7. full dataset refresh only when genuinely necessary.

FULL REFRESH IS THE LAST RESORT.

==================================================
24. NAVIGATION IS NOT INVALIDATION
==================================================

A route transition must not automatically make existing valid data stale.

Example:

Dashboard
→ QBanks
→ Dashboard

should usually reuse the already-loaded valid Dashboard state.

Do not implement:

mount → fetch
unmount → discard
remount → fetch again

without a real freshness reason.

==================================================
25. CACHE OWNERSHIP
==================================================

Each important resource should have one logical data owner.

Examples:

account
banks
questions
progress
collaboration
reviews
exam session
topics
specialties

Do not allow multiple components to independently create competing lifecycles for
the same resource.

Use stable cache keys including appropriate scope such as:

user
bank
question
exam
topic
specialty

Never reuse authenticated private cache data across users.

==================================================
26. IN-FLIGHT DEDUPLICATION
==================================================

Identical simultaneous reads should result in one physical network request where
safe.

Three components asking for the same resource should ideally share one promise
rather than trigger:

3 Worker requests
+
3 D1 query sets.

Request identity must include all privacy-relevant and semantic parameters.

==================================================
27. CACHE FRESHNESS IS RESOURCE-SPECIFIC
==================================================

Do not assign the same stale time to all resources.

Examples:

VERY STABLE:
topics
specialties
static config

SEMI-STABLE:
banks
account metadata
question metadata

REALTIME:
collaboration
review status

SESSION:
active exam
loaded exam questions
temporary navigation state

Every major cached resource should define:

authoritative source
cache owner
freshness
invalidation condition
realtime behavior
cleanup condition

==================================================
28. REALTIME CONSTITUTION
==================================================

Realtime must be:

EVENT-DRIVEN

not:

POLLING-DRIVEN.

A realtime event should preferably describe:

WHAT CHANGED

not:

"something changed, fetch everything."

Where practical include:

entity type
entity id
operation
version/scope

Then:

patch local authoritative state

or:

fetch the smallest affected resource.

==================================================
29. RECONNECT COORDINATION
==================================================

Multiple realtime channels reconnecting during one network recovery event must not
independently cause repeated global synchronization.

A logical network recovery wave should be coordinated.

Conceptually:

Channel A reconnects
Channel B reconnects
Channel C reconnects
↓
ONE coordinated reconciliation

A later independent disconnect must still be observable and reconciled.

==================================================
30. NO REQUEST STORMS
==================================================

Qraft must defend against accidental amplification such as:

1 click
→ 10 equivalent requests

1 WebSocket event
→ multiple full reloads

1 reconnect
→ repeated account/collaboration refreshes

1 React render
→ repeated fetch

1 filter keystroke
→ expensive database query every character

Use:

deduplication
debounce
cancellation
latest-request-wins
event coalescing
bounded concurrency

where appropriate.

==================================================
31. IDLE APPLICATION TARGET
==================================================

A healthy stable page with:

no user activity
no relevant remote change
healthy connection

should generate approximately zero unnecessary application HTTP traffic.

Polling requires explicit justification.

==================================================
32. SMART RETRY POLICY
==================================================

Do not blindly retry every error.

Typical policy:

validation / authorization failure
→ no blind retry

temporary network failure
→ limited retry

transient server failure
→ bounded retry

rate limit
→ respect Retry-After when available

Use backoff and jitter when appropriate.

Never create infinite retry storms.

==================================================
33. REQUEST CANCELLATION
==================================================

Obsolete READ requests may be cancelled.

Examples:

old search
old filter
superseded request

Critical mutations must not be cancelled merely because the user navigates.

Distinguish:

discardable read

from:

durable mutation.

==================================================
34. DATABASE PRINCIPLE
==================================================

Treat D1 as a relational database.

Do not use it like a giant JSON store.

Every important query should be evaluated based on:

purpose
frequency
cardinality
selectivity
rows scanned
rows returned
index availability
sort requirements
join requirements
write impact
growth behavior

==================================================
35. SCAN IS NOT AUTOMATICALLY WRONG
==================================================

Do not blindly optimize for index use.

On small or low-selectivity datasets, a scan may be cheaper.

Likewise:

INDEX IS NOT AUTOMATICALLY BETTER.

Choose based on measured workload.

==================================================
36. INDEX POLICY
==================================================

Indexes must be query-driven.

Frequently-filtered fields such as:

bank_id
question_id
user_id
review_status

should be evaluated for indexing.

Do NOT create an index on every column.

Every proposed index must justify:

read benefit
write cost
storage cost
selectivity
composite ordering
existing overlapping indexes

Target:

THE SMALLEST USEFUL INDEX SET.

==================================================
37. NO N+1
==================================================

Avoid:

load 100 questions
→ query user state 100 times.

Prefer where appropriate:

JOIN
batch lookup
IN
preloaded map
aggregated query

Do not replace N+1 with an uncontrolled giant Cartesian result.

Measure both options.

==================================================
38. SELECT ONLY WHAT IS NEEDED
==================================================

Avoid SELECT * on hot routes when only a small subset is needed.

Do not transfer large question explanations, JSON blobs or metadata when the
current view does not need them.

However do not fragment one efficient query into many network round trips merely
to avoid extra columns.

Optimize total work.

==================================================
39. DATABASE FILTERING VS WORKER FILTERING
==================================================

Avoid:

D1 returns thousands of records
→ Worker filters to 20

when relational filtering can safely return those 20 directly.

This reduces:

rows transferred
CPU
memory
serialization
latency

Do not push complex business semantics into unreadable SQL merely for cleverness.

==================================================
40. PAGINATION
==================================================

Lists that may grow to hundreds/thousands must not be loaded entirely without
reason.

Examples:

questions
review items
imports
activity
Ready Tests
large bank lists

Use pagination/cursors appropriate to the access pattern.

==================================================
41. WRITE AMPLIFICATION
==================================================

Every write should have a purpose.

Classify writes as:

authoritative
audit
derived/statistical
sync metadata
redundant
retry-generated

Never remove authoritative/audit writes solely for cost.

But eliminate proven redundant writes.

==================================================
42. CONDITIONAL WRITES
==================================================

Avoid rewriting unchanged state where practical.

Example:

persisted answer = B
incoming answer = B

should not trigger a full unnecessary downstream write path if semantics do not
require one.

Do not add an expensive read solely to save a cheap write unless total resource
cost improves.

==================================================
43. TRANSACTIONS
==================================================

Related writes representing one logical atomic action must not leave the application
half-completed.

Example:

Approve Question

should not successfully publish the question while leaving its Review Item in an
incorrect pending state.

Use appropriate transaction/recovery semantics.

Do not create giant transactions containing unrelated operations.

==================================================
44. IDEMPOTENCY
==================================================

Critical actions should tolerate network retry and duplicate submission.

Especially:

Import
Submit test
Approve question
Resolve duplicate
important account changes
critical exam writes

Retrying the same logical operation must not execute it twice.

==================================================
45. PARTIAL FAILURE
==================================================

Batch workflows should support partial success where business semantics permit.

One bad item in 100 must not destroy 99 valid independent outcomes.

Do not use partial success where the entire operation is genuinely atomic.

==================================================
46. AUTHORIZATION
==================================================

Authorization is enforced on the SERVER.

Hiding a frontend button is never authorization.

Reviewer endpoints must reject non-reviewers.

Superadmin endpoints must reject non-Superadmin accounts.

Private bank access must be verified server-side.

Subscription/package rules must be verified server-side.

==================================================
47. SUPERADMIN
==================================================

Superadmin may have broad administrative capabilities.

However:

admin endpoints must remain explicit
server-side checks are mandatory
client isAdmin state is never trusted

Sensitive admin actions require audit trails.

==================================================
48. AUDITABILITY
==================================================

Sensitive actions should leave sufficient audit evidence.

Examples:

delete question
reject question
approve edit
resolve duplicate
change permission
administrative action

Audit should answer:

who
when
what entity
what action

Do not turn audit into a permanent copy of every application interaction.

==================================================
49. FAIR USE
==================================================

Paid Full Access is not permission for automated or abusive behavior that threatens
platform stability.

Engineering Fair Use should prioritize:

Observe
→ Flag
→ Review
→ Throttle
→ Restrict if necessary

Do not auto-ban high usage merely because it exceeds an arbitrary number.

Early Qraft should emphasize detection and operator review.

==================================================
50. RATE PROTECTION
==================================================

Apply technical safeguards to expensive or abuse-prone operations.

Examples:

imports
bulk operations
authentication
expensive searches
duplicate detection

Rate protection must be:

resource-aware
user-aware
endpoint-aware

Do not apply one arbitrary global limit to all actions.

==================================================
51. SUBSCRIPTION MODEL
==================================================

Current commercial model should remain compatible with:

Qraft Full Access:
100 SAR / month
230 SAR / 3 months

and the defined free trial behavior.

Paid users should not see arbitrary public monthly question/test quotas unless
product policy changes.

Internal technical safety limits are separate from customer-facing usage quotas.

==================================================
52. TELEMETRY
==================================================

Collect enough operational telemetry to diagnose:

usage
failures
latency
resource consumption
cost
unusual behavior

without unnecessarily collecting user content.

Useful event-level metadata may include:

internal user/account identifier
event type
count
timestamp
duration
success/failure

Do not log question text, private notes, private bank content or sensitive input
merely for analytics.

==================================================
53. DO NOT USE D1 AS CLICK TELEMETRY
==================================================

Do not create one D1 row for every interaction merely to power analytics.

Prefer infrastructure intended for telemetry/analytics such as Workers Analytics
Engine or equivalent low-cost event systems.

D1 is for consistent application data.

==================================================
54. MONITORING & USAGE
==================================================

Superadmin should eventually provide a practical operational view containing:

USER USAGE

APPLICATION HEALTH

INFRASTRUCTURE COST & LOAD

Important metrics may include:

active users
tests created
questions answered
imports
Worker requests
Worker errors
CPU/resource exhaustion
D1 reads
D1 writes
database size
R2 use
realtime health

Do not merely display raw numbers.

Relate infrastructure consumption to application usage.

==================================================
55. ANOMALY DETECTION
==================================================

Build behavioral baselines from actual usage.

Where sufficient data exists use statistics such as:

median
P90
P95
P99

to identify abnormal usage.

Examples:

users +10%
D1 reads +600%

should trigger engineering attention.

Do not automatically assume the users are abusive.

It may indicate a backend regression.

==================================================
56. QUERY MONITORING
==================================================

Monitoring should be capable of answering:

Which route caused the D1 increase?

Which logical query caused the read amplification?

Which workflow caused excessive writes?

Which operation caused Worker CPU exhaustion?

Aggregate infrastructure totals without route/query context are insufficient for
serious diagnosis.

==================================================
57. CLOUDFLARE CREDENTIALS
==================================================

Cloudflare API credentials are server-side secrets.

Never expose them in:

frontend JavaScript
localStorage
public config
repository
client network responses

Monitoring tokens should use the minimum required read-only permissions.

==================================================
58. CLOUD PLATFORM PRINCIPLE
==================================================

Current Cloudflare architecture remains the default:

Workers
D1
R2
Realtime/Durable Objects where currently used

Do not migrate platforms simply because another technology is popular.

Consider migration only when measured evidence shows that the current architecture
cannot satisfy requirements reasonably.

==================================================
59. FRONTEND PERFORMANCE CONTRACT
==================================================

Backend optimizations must improve or preserve frontend experience.

The following are regressions unless specifically intended:

cached route shows unnecessary loading screen
returning to page causes avoidable refetch
exam question change waits for network
realtime update causes page-wide refresh
PWA resume reloads all data
optimistic update leaves wrong state
cached state leaks between users

The application should feel closer to a native application as efficiency improves.

==================================================
60. OPTIMISTIC UI
==================================================

Where an action is:

predictable
reversible
safe

the UI may update immediately before server confirmation.

On failure:

rollback/reconcile.

Do not use optimistic state for operations where temporary false success is unsafe.

==================================================
61. RESPONSIVE / MULTI-DEVICE BEHAVIOR
==================================================

Backend work must not assume one viewport.

Current desktop, tablet and iPhone/PWA experiences may expose different navigation
surfaces while using the same core data contracts.

Avoid backend or state designs that require duplicating logic for every device.

Share the core domain/data layer.

Device-specific presentation belongs in the frontend.

==================================================
62. PWA CONSTITUTION
==================================================

Service Worker changes require special care.

Avoid mixed-version application shells.

Service Worker releases should have:

traceable version identity
safe cache migration
obsolete Qraft cache cleanup
API bypass from inappropriate static caching
preservation of unrelated browser caches
recoverable upgrade behavior

A service-worker update must not silently keep users on incompatible old assets.

==================================================
63. RELEASE REPRODUCIBILITY
==================================================

A release must come from ONE clean commit.

A dirty developer working tree is never a release artifact.

For every candidate:

clean checkout
dependency install from lockfile
tests
database tests
typecheck
lint
build
Cloudflare configuration validation

must succeed from committed state alone.

==================================================
64. STAGING FIRST
==================================================

Meaningful backend/database/realtime changes must be validated against isolated
staging resources before production when risk justifies it.

Staging must not write into production:

D1
R2
Realtime resources
user data

Production and staging identities must be explicit.

==================================================
65. BUILD PROVENANCE
==================================================

Every deployed build should be traceable to:

git SHA
build version
service-worker version
schema version

It must always be possible to answer:

"What source produced this running application?"

==================================================
66. MIGRATION POLICY
==================================================

Database migrations must be:

committed
ordered
reviewed
reproducible
compatible with release code

No test may depend on an uncommitted migration.

Do not silently modify production schema manually.

Prefer forward-compatible migrations.

Code rollback and schema rollback are separate engineering decisions.

==================================================
67. TESTING PHILOSOPHY
==================================================

Do not blindly run a fixed checklist forever.

The AI/engineer must understand the architecture and determine the smallest
sufficient validation plan based on:

critical invariants
changed code
risk
hot paths
production evidence
failure modes

Tests should include appropriate combinations of:

unit
integration
database
browser/end-to-end
staging
load/performance
realtime
security/authorization
migration
PWA

according to the change.

==================================================
68. TEST PRODUCT INVARIANTS, NOT IMPLEMENTATION DETAILS
==================================================

Prefer tests like:

returning to cached Dashboard does not duplicate loads

moving between preloaded questions does not fetch exam again

non-reviewer cannot access Review API

same mutation replay remains idempotent

over brittle assertions about internal function names.

==================================================
69. PERFORMANCE EVIDENCE
==================================================

Never claim an improvement that was not measured appropriately.

Distinguish:

production measurement
staging measurement
local benchmark
deterministic test
static analysis
engineering inference

Do not present one as another.

==================================================
70. BEFORE / AFTER
==================================================

For performance changes:

measure BEFORE

understand cause

make smallest safe change

measure AFTER

verify behavior.

If the optimization:

does not help
makes performance worse
creates disproportionate complexity
or threatens correctness

revert or redesign it.

==================================================
71. SELF-CORRECTING ENGINEERING LOOP
==================================================

For every meaningful engineering decision:

OBSERVE
↓
MEASURE
↓
UNDERSTAND ROOT CAUSE
↓
FORM TESTABLE HYPOTHESIS
↓
IMPLEMENT SMALLEST SAFE CHANGE
↓
TEST CORRECTNESS
↓
REMEASURE
↓
COMPARE
↓
KEEP / REVISE / REVERT

Do not stack speculative fixes on an unverified hypothesis.

==================================================
72. AI AUTONOMY
==================================================

AI agents are expected to reason from the actual project.

Do not require the human to manually enumerate every endpoint or test.

The AI should:

- inspect the relevant architecture;
- identify affected invariants;
- identify highest-risk paths;
- identify highest-cost paths;
- design an appropriate validation plan;
- implement minimal safe changes;
- measure results;
- adapt when evidence contradicts assumptions.

However autonomy does NOT permit changing product semantics without approval.

==================================================
73. AI MUST NOT OVER-ENGINEER
==================================================

Do not introduce:

Redis
Kafka
a new database
vector infrastructure
CQRS
large state frameworks
complex queues
additional Cloudflare products

merely because they are theoretically attractive.

Use the simplest architecture that satisfies measured requirements.

==================================================
74. SCALING PRINCIPLE
==================================================

Every meaningful backend design should ask:

What happens at:

50 users?
500?
5,000?

And:

1,000 questions?
10,000?
100,000?

Do not build enterprise-scale infrastructure prematurely.

But do not knowingly build an O(N²) cliff when a simple bounded design is
available.

==================================================
75. COMPLEXITY AWARENESS
==================================================

Identify accidental:

O(N²)
fan-out
N+1
unbounded scans
unbounded concurrency
unbounded payload growth

especially in:

duplicate detection
imports
review
collaboration
exam processing
realtime synchronization

Big-O is not the only criterion.

Actual workload, constants, indexes and maintainability matter.

==================================================
76. BACKPRESSURE
==================================================

When work arrives faster than the system can safely process it:

do not spawn unlimited parallel work.

Use where appropriate:

bounded concurrency
batching
queueing
coalescing

Never drop critical user data merely to protect throughput.

==================================================
77. COST PRINCIPLE
==================================================

Optimize unnecessary work before buying more capacity.

But do not compromise production reliability just to remain on a free tier.

The goal is:

LOWEST REASONABLE COST FOR A RELIABLE SYSTEM.

==================================================
78. NO SINGLE-USER BLAST RADIUS
==================================================

One user performing an expensive action should not degrade the whole service
disproportionately.

Expensive operations should have appropriate:

resource isolation
concurrency limits
rate protection
batch limits

This is especially important for:

imports
bulk review
duplicate scanning
large administrative jobs.

==================================================
79. STOP CONDITIONS
==================================================

An AI/engineer must STOP and report rather than guess when a proposed change:

- risks user data;
- may change exam scoring;
- weakens authorization;
- creates cross-user cache risk;
- weakens duplicate semantics;
- changes audit semantics;
- requires destructive migration;
- creates uncertain consistency;
- cannot be regression tested;
- depends on an unknown product decision;
- significantly increases architecture complexity without measured justification.

Provide:

the blocker
evidence
options
trade-offs

then await approval.

==================================================
80. DOCUMENTATION AS CODE
==================================================

Important architecture decisions must remain documented near the project.

Maintain documentation for:

request policy
data lifecycle
schema/migrations
release process
monitoring
performance results
staging
rollback

Do not let architecture exist only inside chat history.

==================================================
81. PRODUCT CHANGE CHECKLIST
==================================================

Before implementing a new feature, the engineer/AI must determine:

What entity owns the data?

Is this user-specific or shared?

What are authorization rules?

What writes occur?

What reads occur?

Can the operation become large?

What happens on retry?

What happens on partial failure?

What happens on reconnect?

What invalidates cached state?

Does realtime need to know?

What is the audit requirement?

What happens at 10× current scale?

How will this be tested?

How will this be monitored?

If these questions have no sensible answer, the feature design is incomplete.

==================================================
82. DATABASE CHANGE CHECKLIST
==================================================

Before adding/changing an important query or index ask:

What user action causes it?

How often?

Expected table cardinality?

Rows scanned?

Rows returned?

Selectivity?

Existing index?

Would a new index materially help?

What writes become more expensive?

What happens at 10× data?

Can an existing query be reused?

Is pagination needed?

Can repeated calls be cached/deduplicated?

Has the actual plan been measured?

==================================================
83. FRONTEND/BACKEND CHANGE CHECKLIST
==================================================

Before changing a backend contract ask:

Which frontend routes consume it?

Which components rely on it?

Does mobile/PWA behave differently?

Is the data already cached?

Will this cause extra loading states?

Does realtime invalidate it?

Does it affect active exams?

Does it affect private/public bank authorization?

Will old service-worker clients tolerate the change?

Backward compatibility must be considered during staged rollout.

==================================================
84. DEFINITION OF A GOOD QRAFT FEATURE
==================================================

A well-engineered Qraft feature:

does the correct thing

uses the smallest reasonable data scope

does not repeatedly fetch known information

does not repeatedly write unchanged information

is safe to retry

is authorized server-side

handles partial failure appropriately

does not block unrelated users

scales predictably

can be observed

can be tested

can be rolled back or recovered safely

and fits the existing product behavior.

==================================================
85. DEFINITION OF A BAD QRAFT FEATURE
==================================================

A design is suspect if it relies on:

fetch everything then filter

write on every click

poll constantly

reload page after mutation

reload entire collaboration after one entity changes

compare one import against the entire database

trust frontend authorization

retry forever

run unlimited Promise.all workloads

add indexes without query evidence

cache private data without user scope

deploy dirty working tree

use production as the test environment

or solve inefficiency solely by upgrading infrastructure.

==================================================
86. FINAL ENGINEERING PRINCIPLE
==================================================

Every new engineering decision must ask:

"Will this design remain logical as Qraft moves from
50 users
to 500
to 5,000?"

The answer is NOT to build massive infrastructure now.

The answer is:

SIMPLE NOW
+
MEASURABLE FROM DAY ONE
+
SCALABLE WHEN EVIDENCE REQUIRES IT.

==================================================
87. EXECUTION INSTRUCTION FOR AI AGENTS
==================================================

Before making a substantial Qraft change:

1. Read this constitution.
2. Inspect the current project and current intended frontend.
3. Identify affected product invariants.
4. Identify affected data entities.
5. Identify authorization implications.
6. Identify request/read/write/realtime impact.
7. Inspect current implementation before proposing replacement.
8. Establish a baseline where meaningful.
9. Design the smallest correct solution.
10. Implement in reversible, focused changes.
11. Add appropriate tests.
12. Measure where the change concerns performance.
13. Validate on staging where risk warrants it.
14. Document significant architectural decisions.
15. Do not deploy production unless explicitly authorized.

If project reality contradicts an assumption in this document:

DO NOT silently violate the constitution.

Document:

- the contradiction;
- evidence;
- proposed constitutional amendment;
- trade-offs;

and request approval.

==================================================
88. ULTIMATE QRAFT RULE
==================================================

Do not engineer Qraft as a collection of independent pages and endpoints.

Engineer it as one coherent system in which:

Frontend state
Network requests
Realtime events
Worker execution
Database reads
Database writes
Caching
Authorization
Audit
Monitoring
Cost

all represent different parts of the same application lifecycle.

Optimize the SYSTEM.

Not one metric.
Not one route.
Not one benchmark.




==================================================
SUPERADMIN EXCLUSIVE PRIVILEGES
==================================================

Superadmin is not an ordinary paid user.

Superadmin is the highest-trust operational role in Qraft and may have
capabilities that are intentionally unavailable to:

- Free users
- Paid users
- Bank owners
- Reviewers

Superadmin-exclusive capabilities may include, where implemented and justified:

- bypassing ordinary product usage quotas;
- bypassing selected Fair Use restrictions for legitimate administrative work;
- larger import or bulk-operation limits;
- bulk content management;
- cross-bank administrative inspection;
- reviewer and user management;
- moderation and recovery actions;
- administrative corrections;
- system-wide maintenance operations;
- controlled test/debug operations;
- access to Monitoring & Usage;
- operational diagnostics;
- manual reconciliation/recovery tools;
- privileged import/export tools;
- management of public QBank content;
- exceptional actions required to maintain platform integrity.

These privileges are intentional product behavior and must not automatically
be treated as authorization bugs merely because ordinary users cannot perform them.

==================================================
SUPERADMIN AUTHORIZATION
==================================================

Every Superadmin-only capability MUST be authorized server-side.

The backend must verify the authenticated account's authoritative role.

Never trust:

isAdmin
isSuperadmin
role

values supplied by the frontend.

Hiding or showing an admin button is UI behavior only and is NOT authorization.

If a non-Superadmin manually calls a Superadmin endpoint, the backend must reject it.

==================================================
SUPERADMIN MAY HAVE DIFFERENT LIMITS
==================================================

Ordinary technical/product limits do not automatically apply to Superadmin.

Every limit must explicitly define its scope.

For example:

User import limit:
150 questions per normal import batch.

Superadmin:
may be allowed a larger administrative batch size or a dedicated bulk-import path.

Therefore:

151 questions submitted through an explicitly authorized Superadmin bulk-import
workflow is NOT automatically a constitutional violation.

However, do not silently bypass limits merely because the account is Superadmin.

The exception must be intentional and implemented through an explicit
administrative code path or policy.

==================================================
SUPERADMIN DOES NOT MEAN UNBOUNDED EXECUTION
==================================================

Superadmin authority does NOT justify unsafe backend behavior.

Even privileged operations must protect:

- Worker CPU
- D1
- memory
- transaction integrity
- other users
- platform availability

For large administrative operations prefer:

bounded batches
queues
controlled concurrency
progress tracking
checkpointing

rather than one unbounded request.

Superadmin may have a higher or different limit,
but the backend must still have engineering safety boundaries.

==================================================
SUPERADMIN AUDIT REQUIREMENT
==================================================

High-impact Superadmin operations must be auditable.

Record sufficient metadata to determine:

- which Superadmin performed the action;
- when;
- operation type;
- affected entity or scope;
- result;
- relevant administrative reason where required.

Do not unnecessarily store sensitive content in audit telemetry.

Examples of actions requiring audit include:

- bulk deletion;
- bulk import;
- permission changes;
- reviewer management;
- public-bank modification;
- duplicate resolution;
- administrative data correction;
- exceptional limit override.

==================================================
SUPERADMIN PRODUCT EXEMPTION RULE
==================================================

Unless explicitly stated otherwise:

customer-facing subscription quotas and ordinary Fair Use enforcement
do not restrict legitimate Superadmin administrative operations.

This exemption must NOT propagate to ordinary users merely because they interact
with content created by Superadmin.

==================================================
SUPERADMIN SAFETY RULE
==================================================

When the AI encounters behavior where Superadmin can perform an operation that
ordinary users cannot:

DO NOT classify it as a bug solely because of the privilege difference.

First determine whether the behavior is:

1. an intentional Superadmin-exclusive capability;
2. an undocumented privilege;
3. an authorization vulnerability.

If product intent is unclear, stop and request reconciliation.

Never remove a Superadmin capability merely to make role behavior uniform.