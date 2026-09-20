# Private QBank and share-link security

Private QBank authority remains in D1 QBank ownership/membership records. Listing and collaboration loads are scoped to accessible banks; knowing an ID is insufficient. Owner-only operations include membership/share-link management and destructive bank operations. Editors can change allowed content but cannot acquire owner controls.

Share links are server-created, bound to the bank, explicitly accepted/declined, and checked against current bank/link state. Deletion/revocation prevents the stale link from granting new access. Tokens/links are not treated as hidden UI security.

Question reads, imports, edits, suggestions, reports, media upload/delete, and folder cascade operations resolve the target bank and relationship at the server. Essential banks add a Superadmin boundary: non-Superadmins use reviewed proposals.

Evidence:

- Existing integration tests cover private bank read/mutation boundaries, owner versus editor, invite decisions, collaboration read scope, imports, deletion, and media.
- Phase 4 tests cover private ready-made-test media separately because it uses a distinct visibility/attempt model.
- No production link enumeration or destructive revocation testing was performed.
