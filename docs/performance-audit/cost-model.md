# Phase 9: Cloudflare cost model

Captured 2026-09-24. Prices and allowances can change; verify the official pages before a plan or deployment decision.

## Pricing assumptions

Official Cloudflare references used:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

Relevant published allowances at capture time:

| Resource | Free | Workers Paid included usage |
|---|---:|---:|
| Worker requests | 100,000/day | 10 million/month |
| Worker CPU | 10 ms CPU/invocation allowance | 30 million CPU-ms/month; configurable per-invocation ceiling |
| D1 rows read | 5 million/day | 25 billion/month |
| D1 rows written | 100,000/day | 50 million/month |
| D1 storage | 5 GB total | 5 GB included |

The Workers Paid subscription has a $5/month base according to the cited page. Durable Object and R2 request/duration/storage charges depend on actual analytics that were not included in the supplied metrics.

## Current aggregate model

Assuming the supplied daily observations are representative and multiplying by 30:

| Resource | Daily | 30-day equivalent | Free status | Paid included status |
|---|---:|---:|---|---|
| Worker requests | 2,085 | 62,550 | 2.1% of daily request allowance | 0.6% of included monthly requests |
| D1 queries | 16,000 | 480,000 | queries are not the billing unit | n/a |
| D1 rows read | 46.0M | 1.38B | 920% of daily allowance | 5.5% of included monthly reads |
| D1 rows written | 101,000 | 3.03M | 101% of daily allowance | 6.1% of included monthly writes |
| D1 storage | 12.7 MB | 12.7 MB plus growth | about 0.25% of 5 GB | about 0.25% of 5 GB |

The Free plan is not a reliable production operating point: reads are about 9.2 times the daily allowance, writes slightly exceed it, and production querying returned the D1 daily-limit error. Worker request volume is small, but seven `exceededResources` outcomes show that the Free CPU ceiling is material.

At the observed aggregate volume, Workers Paid plus D1 should remain within included request, D1 read/write and storage allowances. Subject to R2/Durable Object usage and taxes, the expected minimum is therefore approximately **$5/month**. Paying removes the low Free ceiling; it does not remove inefficient queries or resource exhaustion caused by a route's CPU limit.

## Known but unquantified resources

| Resource | Current design | Required input before costing |
|---|---|---|
| Durable Objects | One hibernating realtime audience per user/bank/catalog/admin/access channel; invalidations only | DO requests, WebSocket messages and duration analytics |
| R2 | Media plus question/personal backups | stored GB, Class A/B operations and egress category |
| Rate limiting bindings | Three namespaces on API lifecycle | plan-specific usage/charge analytics |
| Worker CPU | 2,085 requests/day, seven failures | route CPU distribution and total monthly CPU-ms |

The DO implementation uses the hibernation API, which Cloudflare recommends for WebSockets that spend substantial time idle ([WebSocket hibernation guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)). No evidence justifies adding KV, Queues or another Cloudflare product in this pass.

## Read-optimization scenarios

The collaboration query rewrite saves **10,184 D1 rows per representative collaboration load** while returning the same measured records. Let `L` be collaboration network loads per day:

```text
projected daily rows read = 46,000,000 - (10,184 × L)
```

This is bounded at zero and must not be presented as a measured after value.

| Collaboration loads/day | Estimated rows avoided/day | Estimated remaining reads/day | Free D1 read allowance |
|---:|---:|---:|---:|
| 100 | 1.02M | 44.98M | still over |
| 500 | 5.09M | 40.91M | still over |
| 1,000 | 10.18M | 35.82M | still over |
| 2,000 | 20.37M | 25.63M | still over |
| 4,000 | 40.74M | 5.26M | approximately near, but this load count is not established |

Even a large reduction may not make Free the correct production plan. The optimization is justified by reliability, latency and scale rather than by avoiding a $5 subscription.

## Reconnect-request scenario

If a browser has `C` channels and all reconnect at staggered times, the current design can initiate as many as `C` account refreshes and `C` collaboration refreshes. Single-flight reduces this only when requests overlap. Coalescing a reconnect wave reduces the upper bound to one refresh pair:

```text
avoided Worker requests per resume <= 2 × (C - 1)
```

Actual savings require browser telemetry for channel count, resume frequency and overlap.

## Write-optimization scenarios

The measured answer checkpoint cost is approximately 12 billed rows per changed answer before state-sync writes. Let `A` be changed answers checkpointed per day and `W_other` all other writes:

```text
current estimated writes = (12 × A) + W_other
```

Possible models:

| Model | Approximate answer/audit write term | Estimated reduction for this term | Decision required |
|---|---:|---:|---|
| Current per-answer audit | `12 × A` | none | none |
| One checkpoint audit | `6 × A + 6 × checkpoints` | approaches 50% for large checkpoints | approve changed audit granularity |
| No answer-stat audit | `6 × A` | 50% | approve audit exception |
| Normalized answer row + checkpoint audit | roughly `2 × A + 6 × checkpoints` | up to about 83% in the 100-answer probe | migration and architecture review |

The production share of the 101,000 daily rows written is not yet attributed to answer checkpoints, imports, bulk review, cleanup or other operations. No total after estimate is valid until per-route D1 metadata is collected.

## Capacity interpretation

- Current request volume is low; request pricing is not the problem.
- D1 row-read efficiency is the clearest cost/scalability problem.
- D1 writes are amplified by the polymorphic record indexes and audit policy.
- CPU tail behavior is a reliability concern even when average paid CPU usage remains inexpensive.
- The 12.7 MB database is far below storage limits; migrating databases for storage reasons is unjustified.
- Workers + D1 remains economically suitable after the concrete optimizations. The expected base platform cost is small relative to the operational risk of relying on exhausted Free limits.

## Recommended operating choice

Use Workers Paid for production reliability while implementing and validating the high-confidence query/request fixes. Keep staging/local development on the least costly appropriate tier. Revisit product choices only after route-level CPU, R2 and Durable Object metrics show a specific cost or scaling constraint.

## Phase 11 cost-validation status

Phase 11 produced no canary resource measurements because the pinned candidate failed the clean pre-deployment gate and no isolated staging resources are configured. The monthly figures in this document remain Phase 0-10 baseline measurements and scenario projections; they are not Phase 11 after-values.

Do not reduce the estimate by applying the local `-89.9%` collaboration result or `-61.37%` duplicate benchmark to aggregate production totals. A future staging/canary run must measure collaboration-load frequency, Worker CPU-ms, D1 rows by logical query, R2 operations/storage, and Durable Object requests/messages before updating the monthly projection. The current recommendation—Workers Paid with an expected minimum near $5/month plus measured R2/DO usage—remains an operating recommendation, not a newly validated Phase 11 cost result.
