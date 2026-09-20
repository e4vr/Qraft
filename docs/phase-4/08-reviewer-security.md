# Reviewer security

Reviewer capability is loaded from server profile/platform-role state. It is independent of the paid plan and cannot be self-assigned through profile updates or client state.

Review decisions require an authenticated authorized reviewer, a current proposal, a valid target, and an allowed unresolved transition. Actor/reviewer identity and timestamps come from the server. High-risk corrections require two independent reviewers; duplicate decisions and uploader/reviewer identity manipulation are rejected. Bulk decisions are transactionally bounded to 200 selected proposals.

Reviewer removal takes effect on the next server request even when an old tab remains visible. Realtime subscription authorization is also checked server-side; a guessed reviewer channel does not establish the role.

Verified negative paths include normal user accessing review aggregation, reviewer attempting Superadmin functions, malformed/duplicate transitions, and platform roles not changing plan. Audit events for authoritative review operations are server authored.
