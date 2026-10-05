import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['features/contributions/domain/proposal-filters.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { PROPOSAL_EDIT_KINDS, matchesProposalFilters } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const proposals = [
  { id: 'new', type: 'new_question', editKinds: [], detected: false },
  { id: 'multi', type: 'question_edit', editKinds: ['question_text', 'options'], detected: false },
  { id: 'missing', type: 'question_edit', editKinds: ['missing_information'], detected: false },
  { id: 'image', type: 'question_edit', editKinds: ['image_media'], detected: false },
  { id: 'other', type: 'question_edit', editKinds: ['other'], detected: false },
  { id: 'reported-duplicate', type: 'question_edit', editKinds: ['duplicate'], detected: false },
  { id: 'detected-duplicate', type: 'new_question', editKinds: [], detected: true },
  { id: 'detected-edit', type: 'question_edit', editKinds: ['explanation'], detected: true },
];
const visible = (category, kind = 'all') => proposals
  .filter(proposal => matchesProposalFilters(proposal, category, kind, proposal.detected))
  .map(proposal => proposal.id);

void test('All preserves every proposal, and new questions ignore report-only classifications', () => {
  assert.deepEqual(visible('all'), proposals.map(proposal => proposal.id));
  assert.deepEqual(visible('new', 'question_text'), ['new', 'detected-duplicate']);
});

void test('reports and edits exclude duplicate cases and match any selected report kind', () => {
  assert.deepEqual(visible('edits'), ['multi', 'missing', 'image', 'other']);
  assert.deepEqual(visible('all', 'question_text'), ['multi']);
  assert.deepEqual(visible('edits', 'options'), ['multi']);
  assert.deepEqual(visible('edits', 'missing_information'), ['missing']);
  assert.deepEqual(visible('edits', 'image_media'), ['image']);
  assert.deepEqual(visible('edits', 'other'), ['other']);
  assert.deepEqual(visible('edits', 'source'), []);
});

void test('duplications include reported and detected duplicates with intersecting classifications', () => {
  assert.deepEqual(visible('duplicates'), ['reported-duplicate', 'detected-duplicate', 'detected-edit']);
  assert.deepEqual(visible('duplicates', 'duplicate'), ['reported-duplicate']);
  assert.deepEqual(visible('duplicates', 'explanation'), ['detected-edit']);
  assert.deepEqual(visible('edits', 'duplicate'), []);
});

void test('every report classification can find a submitted edit', () => {
  for (const [kind] of PROPOSAL_EDIT_KINDS) {
    const proposal = { type: 'question_edit', editKinds: [kind] };
    assert.equal(matchesProposalFilters(proposal, 'all', kind, false), true);
    assert.equal(matchesProposalFilters(proposal, 'all', 'all', false), true);
    assert.equal(matchesProposalFilters(proposal, 'new', kind, false), false);
  }
});
