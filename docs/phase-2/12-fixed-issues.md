# Fixed Issues

| ID | Severity | Origin | Root cause | Repair | Evidence |
| --- | --- | --- | --- | --- | --- |
| P2-001 | LOGIC-HIGH | PRE-EXISTING | Private-note comparison ran only when an app-state row existed | compare first writes against empty prior progress | first-write Lite/reviewer API test |
| P2-002 | LOGIC-HIGH | PRE-EXISTING | Offline collaboration saved a snapshot but no replay operation | durable coalesced IndexedDB outbox; startup/reconnect flush | domain coalescing test + source/integration regression |
| P2-003 | LOGIC-HIGH | PRE-EXISTING | Direct QBank delete depended on the client sending every child delete | server-side D1 cascade for records/share/classification | direct-delete integration test |
| P2-004 | LOGIC-HIGH | PRE-EXISTING | Exam checkpoint wrote state before validating answer-stat payload | validate before forwarding to state write | no-partial-write integration test |
| P2-005 | LOGIC-HIGH | PRE-EXISTING | Two concurrent IDs could read one valid attempt token before either deleted it | unique receipt token hash and conflict response | concurrent submit integration test |
| P2-006 | LOGIC-MEDIUM | PRE-EXISTING | App-state validation allowed duplicate test/question/deck/card identities and multi-node deck cycles | uniqueness and graph-cycle validation | impossible-state integration test |
| P2-007 | LOGIC-MEDIUM | PRE-EXISTING | Generic records were unique by record ID, not QBank/user membership identity | final change-set uniqueness validation after authorization | duplicate membership integration test |
| P2-008 | LOGIC-MEDIUM | PRE-EXISTING | Raw timestamp text comparison and JS overflow calendar arithmetic | parsed/canonical UTC times and clamped calendar duration | API and pure boundary tests |

No repair changes prices, role hierarchy, UI design, question identity semantics or the manual paid-checkout model.
