import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ stdin: { contents: "export * from './features/imports/domain/import-classifications'; export * from './features/imports/client/open-import-workspace';", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm' });
const m = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const specialties = [{ id: 'card', qbankId: 'a', name: 'Cardiology' }, { id: 'renal', qbankId: 'a', name: 'Nephrology' }, { id: 'private', qbankId: 'b', name: 'Other bank specialty' }];
const topics = [{ qbankId: 'a', specialtyId: 'card', name: 'Heart failure' }, { qbankId: 'a', specialtyId: 'renal', name: 'Renal failure' }, { qbankId: 'b', specialtyId: 'private', name: 'Other bank topic' }, { qbankId: 'a', specialtyId: 'missing', name: 'Orphan topic' }];

void test('bank suggestions contain only the selected bank and retain specialty-topic relationships', () => {
  const catalog = m.importBankClassifications('a', specialties, topics);
  assert.deepEqual(catalog.specialties, ['Cardiology', 'Nephrology']);
  assert.deepEqual(m.importTopicNames(catalog, ' CARDIOLOGY '), ['Heart failure']);
  assert.deepEqual(m.importTopicNames(catalog, 'New specialty'), []);
  assert.deepEqual(m.importTopicNames(catalog, ''), ['Heart failure', 'Renal failure']);
});

void test('file and edited names extend suggestions without creating duplicate case or whitespace variants', () => {
  const catalog = m.mergeImportClassifications(m.importBankClassifications('a', specialties, topics), m.importQuestionClassifications([{ specialty: ' cardiology ', topic: ' Heart   failure ' }, { specialty: 'New specialty', topic: 'New topic' }]));
  assert.deepEqual(catalog.specialties, ['Cardiology', 'Nephrology', 'New specialty']);
  assert.deepEqual(m.importTopicNames(catalog, 'New specialty'), ['New topic']);
  assert.equal(catalog.topics.length, 3);
  assert.deepEqual(m.mergeImportClassifications({ specialties: [null, 1], topics: [null, {}, { specialty: 'Valid', name: 1 }] }), { specialties: [], topics: [] });
});

void test('matching ranks prefixes first, tolerates Arabic vowel marks and accents, and bounds the visible list', () => {
  assert.deepEqual(m.classificationSuggestions(['Pediatric cardiology', 'Cardiology', 'Carcinoma'], 'card'), ['Cardiology', 'Pediatric cardiology']);
  assert.deepEqual(m.classificationSuggestions(['Médecine', 'طبّ الأطفال'], 'med'), ['Médecine']);
  assert.deepEqual(m.classificationSuggestions(['طبّ الأطفال'], 'طب الاطفال'), ['طبّ الأطفال']);
  assert.equal(m.classificationSuggestions(Array.from({ length: 100 }, (_, i) => `Topic ${i}`), '').length, 12);
  assert.deepEqual(m.classificationSuggestions(['Cardiology'], 'Completely new name'), []);
});

void test('Import buttons transfer only bank taxonomy and never reuse another account context', () => {
  const session = new Map(), local = new Map(); let url;
  globalThis.sessionStorage = { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, value) };
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) };
  globalThis.window = { location: { assign: value => { url = value; } } };
  m.openImportWorkspace({ uid: 'owner-a' }, 'a', 'Bank A', { specialties, topics });
  assert.equal(url, '/qbanks/a/import');
  assert.deepEqual(m.importWorkspaceContext('a').classifications.specialties, ['Cardiology', 'Nephrology']);
  m.bindImportWorkspace('a', 'owner-a', 'Bank A');
  assert.deepEqual(m.importWorkspaceContext('a').classifications.specialties, ['Cardiology', 'Nephrology']);
  local.set('qraft-current-account', 'owner-b');
  assert.equal(m.importWorkspaceContext('a').classifications, undefined);
});
