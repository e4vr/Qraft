import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ stdin: { contents: `export {reviewerPeriods} from './lib/reviewer-periods'; export {deleteFlashcardDeck} from './lib/flashcard-deletion'; export {initialAppState} from './lib/medguard-types';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { reviewerPeriods, deleteFlashcardDeck, initialAppState } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
void test('Reviewer dates use local midnight and correct month boundaries, including DST', () => {
  const r = reviewerPeriods('Asia/Riyadh', new Date('2026-08-31T22:00:00Z'));
  assert.equal(r.todayStart,'2026-08-31T21:00:00.000Z');
  assert.equal(r.monthStart,r.todayStart);
  assert.equal(r.monthEnd,'2026-09-30T21:00:00.000Z');
  const dst = reviewerPeriods('America/New_York', new Date('2026-03-08T16:00:00Z'));
  assert.equal(Date.parse(dst.todayEnd)-Date.parse(dst.todayStart),23*3600000);
});
void test('Deleting a deck removes its tree and schedules, preserving other banks and questions', () => {
  const state = initialAppState();
  state.flashcardDecks = [{ id:'parent',qbankId:'bank' },{ id:'child',qbankId:'bank',parentId:'parent' },{ id:'other',qbankId:'other-bank' }];
  state.flashcards = [{ id:'a',deckId:'parent',qbankId:'bank' },{ id:'b',deckId:'child',qbankId:'bank' },{ id:'c',deckId:'other',qbankId:'other-bank' }];
  state.flashcardSchedules = { a:{},b:{},c:{} };
  state.flashcardReviewLog = [{ cardId:'a' },{ cardId:'b' }];
  const next = deleteFlashcardDeck(state,'parent','bank');
  assert.deepEqual(next.flashcards.map(card => card.id),['c']);
  assert.deepEqual(Object.keys(next.flashcardSchedules),['c']);
  assert.deepEqual(next.flashcardReviewLog,[]);
  assert.deepEqual(next.flashcardDecks.map(deck => deck.id),['other']);
  assert.equal(next.customQuestions,state.customQuestions);
  assert.equal(deleteFlashcardDeck(state,'parent','other-bank'),state);
  assert.equal(state.flashcards.length,3);
});
