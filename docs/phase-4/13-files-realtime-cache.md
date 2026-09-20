# Files, realtime, and cache security

## R2/files

Uploads validate purpose/type/size, hash content, generate controlled keys, deduplicate, and store metadata/ownership in D1. New content uses private R2 reads through the Worker. Legacy ImageKit records remain read-compatible; new ticket attachments are rejected by current product policy.

Ready-made-test media now resolves its owning test. Owner access is allowed; non-owner access requires published status and then either public visibility, current-version authenticated participation, or a matching unexpired version-scoped attempt token. Draft media is denied.

## Realtime

Durable Object WebSockets validate Origin, authenticate the session, and authorize the requested user/QBank channel. Reconnect repeats authorization. Tests verify guessed channels cannot substitute for membership and two authorized sessions receive saved changes.

## Cache/privacy

Authenticated JSON uses `Cache-Control: no-store`. The service worker excludes API/authenticated application data. Private media is served through authorized Worker logic; public cache assumptions were not used for permission. The response-header layer preserves WebSocket 101 upgrades.

The media attempt token appears in a query parameter. It is short-lived, hashed in D1, resource/version bound, and cross-origin referrers omit the path/query under the configured policy. It should still be treated as a bearer capability and omitted from analytics/log exports.
