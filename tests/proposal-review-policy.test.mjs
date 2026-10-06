import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = await build({ entryPoints: ['features/contributions/domain/proposal-review-policy.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { canReviewProposalAuthorship } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

void test('only Superadmin can review their own new questions; self-edit reviews remain independent', () => {
  for (const role of ['student', 'reviewer', 'moderator', 'admin', 'super_admin']) {
    const user = { uid: 'author', role };
    assert.equal(canReviewProposalAuthorship(user, { type: 'new_question', proposedById: 'author' }), role === 'super_admin');
    assert.equal(canReviewProposalAuthorship(user, { type: 'question_edit', proposedById: 'author' }), false);
    for (const type of ['new_question', 'question_edit']) assert.equal(canReviewProposalAuthorship(user, { type, proposedById: 'another-author' }), true);
  }
});

void test('review workspace displays Superadmin uploads while hiding ordinary reviewers own submissions', async () => {
  await mkdir('.ui-review', { recursive: true });
  const file = '.ui-review/proposal-review-render.mjs';
  await build({ stdin: { contents: "export {ReviewWorkspace} from './components/review-workspace'; export {initialCollaborationState} from './lib/medguard-types';", resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, outfile: file });
  const { ReviewWorkspace, initialCollaborationState } = await import(pathToFileURL(`${process.cwd()}/${file}`).href);
  const proposal = (id, author) => ({ id, qbankId: 'review-bank', type: 'new_question', status: 'pending', editKinds: [], proposedById: author, proposedByName: author, proposedAt: new Date().toISOString(), submissionMethod: 'json', rationale: 'Uploaded file', payload: { specialty: 'Medicine', topic: 'Review', stem: `Synthetic ${id} question`, options: ['First', 'Second'], answer: 0, explanation: '', images: [], explanationImages: [], sourceFile: 'QA.json' } });
  const collaboration = { ...initialCollaborationState(), qbanks: [{ id: 'review-bank', name: 'Review bank', ownerId: 'owner', visibility: 'public' }], proposals: [proposal('own', 'author'), proposal('other', 'another-author')] };
  for (const role of ['super_admin', 'reviewer']) {
    const user = { uid: 'author', role, platformRoles: [], displayName: 'Author' };
    const html = renderToStaticMarkup(createElement(ReviewWorkspace, { user, collaboration, update: () => {}, replaceFromServer: () => {}, activeQBankId: 'review-bank' }));
    assert.equal(html.includes('Synthetic own question'), role === 'super_admin');
    assert.ok(html.includes('Synthetic other question'));
  }
});
