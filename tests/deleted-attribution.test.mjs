import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const output = await build({
  entryPoints: ['features/administration/domain/deleted-registration.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const {
  anonymizeDeletedAttribution,
  isDeletedAccountProfile,
  DELETED_USER_ID,
} = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);
const user = {
  uid: 'author-a',
  email: 'author@example.test',
  phone: '0501234567',
  universityId: '123456',
};

void test('deleted attribution retains existing owners and independent reviewers while scrubbing nested personal fields', () => {
  const value = {
    ownerId: 'current-owner',
    ownerName: 'Current owner',
    createdById: user.uid,
    createdByName: 'Former author',
    viewerIds: [user.uid, 'reader'],
    reviewerIds: ['reviewer', user.uid],
    history: [
      { reviewerId: user.uid, reviewerName: 'Former author' },
      { reviewerId: 'author-b', reviewerName: 'Author B' },
    ],
    detail: JSON.stringify({
      userId: user.uid,
      userName: 'Former author',
      email: user.email,
      phone: user.phone,
      universityId: user.universityId,
    }),
    stem: 'A medical question',
    options: ['A', 'B'],
  };
  const once = anonymizeDeletedAttribution(value, user, 'deleted-reviewer-a');
  assert.equal(once.ownerId, 'current-owner');
  assert.equal(once.ownerName, 'Current owner');
  assert.equal(once.createdById, DELETED_USER_ID);
  assert.equal(once.createdByName, 'Deleted user');
  assert.deepEqual(once.viewerIds, ['reader']);
  assert.deepEqual(once.reviewerIds, ['reviewer']);
  assert.deepEqual(JSON.parse(once.detail), {
    userId: DELETED_USER_ID,
    userName: 'Deleted user',
    email: '',
    phone: '',
    universityId: '',
  });
  const twice = anonymizeDeletedAttribution(
    once,
    { uid: 'author-b' },
    'deleted-reviewer-b',
  );
  assert.deepEqual(
    twice.history.map((v) => v.reviewerId),
    ['deleted-reviewer-a', 'deleted-reviewer-b'],
  );
  assert.equal(twice.stem, value.stem);
  assert.deepEqual(twice.options, value.options);
  assert.equal(value.createdById, user.uid);
});

void test('deleted classification requires an inert anonymized profile, not its display name or suspension alone', () => {
  const deleted = {
    uid: 'deleted-legacy',
    email: 'deleted-legacy@deleted.invalid',
    displayName: 'Deleted user',
    deletedAt: '2026-10-05T00:00:00Z',
    role: 'student',
    status: 'rejected',
    suspended: true,
    platformRoles: [],
  };
  assert.equal(isDeletedAccountProfile(deleted), true);
  for (const change of [
    { uid: 'real-account' },
    { email: 'real@example.test' },
    { deletedAt: 'invalid' },
    { deletedAt: undefined },
    { status: 'approved' },
    { role: 'super_admin' },
    { suspended: false },
    { platformRoles: ['moderator'] },
  ])
    assert.equal(isDeletedAccountProfile({ ...deleted, ...change }), false);
});
