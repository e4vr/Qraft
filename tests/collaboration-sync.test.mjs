import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

void test('QBank changes sync without client-authored audit records', async () => {
  await mkdir('.ui-review', { recursive: true });
  const output = '.ui-review/collaboration-sync-test.mjs';
  await build({
    entryPoints: ['features/collaboration/client/collaboration-client.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: output,
  });
  const { collaborationChangeSet } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );
  const base = {
    qbanks: [],
    qbankFolders: [],
    memberships: [],
    invitations: [],
    members: [],
    allowedUniversityIds: [],
    blockedAccess: { emails: [], phones: [], universityIds: [] },
    adminInvites: [],
    proposals: [],
    roleApplications: [],
    approvedQuestions: [],
    specialties: [],
    topics: [],
    answerStats: {},
    sharedNotes: {},
    auditLog: [],
  };
  const bank = { id: 'new-bank', name: 'New bank' };
  const created = {
    ...base,
    qbanks: [bank],
    auditLog: [{ id: 'local-create', action: 'qbank_created' }],
  };
  assert.deepEqual(collaborationChangeSet(created, base), [
    { collection: 'qbanks', id: bank.id, value: bank, type: 'set', baseValue: null },
  ]);

  const edited = {
    ...created,
    qbanks: [{ ...bank, name: 'Renamed bank' }],
    auditLog: [
      { id: 'local-edit', action: 'qbank_updated' },
      ...created.auditLog,
    ],
  };
  assert.deepEqual(collaborationChangeSet(edited, created), [
    { collection: 'qbanks', id: bank.id, value: edited.qbanks[0], type: 'set', baseValue: bank },
  ]);
  assert.deepEqual(collaborationChangeSet({ ...created, qbanks: [] }, created), [
    { collection: 'qbanks', id: bank.id, type: 'delete', baseValue: bank },
  ]);
  assert.deepEqual(
    collaborationChangeSet({ ...base, auditLog: created.auditLog }, base),
    [],
  );
});
