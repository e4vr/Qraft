import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('collaborative governance is enforced in Firestore rules', async () => {
  const rules = await readFile(new URL('firestore.rules', root), 'utf8');
  assert.match(rules, /profile\(\)\.status == 'approved'/);
  assert.match(rules, /profile\(\)\.role in \['admin', 'super_admin'\]/);
  assert.match(rules, /profile\(\)\.role == 'super_admin'/);
  assert.match(rules, /match \/questionProposals\/\{proposalId\}/);
  assert.match(rules, /allow update: if admin\(\)/);
  assert.match(rules, /request\.resource\.data\.version == resource\.data\.version \+ 1/);
  assert.match(rules, /request\.resource\.data\.history\.size\(\) == resource\.data\.history\.size\(\) \+ 1/);
});

test('student IDs are single-claim and registration starts pending', async () => {
  const rules = await readFile(new URL('firestore.rules', root), 'utf8');
  const client = await readFile(new URL('lib/firebase-client.ts', root), 'utf8');
  assert.match(rules, /resource\.data\.claimedById == null/);
  assert.match(rules, /request\.resource\.data\.claimedById == request\.auth\.uid/);
  assert.match(client, /if \(!allowed\.exists\(\) \|\| allowed\.data\(\)\.claimedById\)/);
  assert.match(client, /status: 'pending'/);
});

test('separate QBanks and attributed shared notes are present', async () => {
  const types = await readFile(new URL('lib/medguard-types.ts', root), 'utf8');
  const app = await readFile(new URL('components/medguard-app.tsx', root), 'utf8');
  assert.match(types, /activeQBankId: 'smle-gs'/);
  assert.match(types, /interface SharedQuestionNote/);
  assert.match(types, /updatedByName: string/);
  assert.match(app, /Save shared note/);
  assert.match(app, /Submit for approval/);
});
