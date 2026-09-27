import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import ts from 'typescript';

const detectorPath = new URL('../features/duplicates/domain/duplicate-detection.ts', import.meta.url);
const detectorSource = await readFile(detectorPath, 'utf8');
const compiled = ts.transpileModule(detectorSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const detector = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const payload = (overrides = {}) => ({
  stem: 'A 65-year-old patient has right-sided weakness. What is the NEXT best step?',
  options: ['Noncontrast CT', 'MRI brain', 'Aspirin 50 mg', 'Observation'],
  answer: 0,
  specialty: 'Neurology',
  topic: 'Stroke',
  ...overrides,
});

const candidate = (id, question, qbankId = 'bank-a', entityType = 'approved_question') =>
  detector.prepareDuplicateCandidate({ entityId: id, entityType, qbankId, payload: question });

void test('canonical exact matching ignores formatting and option labels but preserves answer content', () => {
  const original = payload();
  const formatted = payload({
    stem: '  QUESTION 12) a 65-year-old patient has right-sided weakness.   what is the next best step? ',
    options: ['B. MRI brain', 'A. Noncontrast CT', 'D. Observation', 'C. Aspirin 50 mg'],
    answer: 1,
  });
  const result = detector.compareDuplicateContent(original, formatted);
  assert.equal(result.exact, true);
  assert.equal(result.score, 1);
  assert.equal(result.sourceFingerprint, result.candidateFingerprint);
});

void test('negation, laterality, decimals, signs and doses remain meaning-sensitive', () => {
  const base = payload({ stem: 'Which finding is NOT expected on the right after 5.0 mg/kg?' });
  for (const changed of [
    payload({ stem: 'Which finding is expected on the right after 5.0 mg/kg?' }),
    payload({ stem: 'Which finding is NOT expected on the left after 5.0 mg/kg?' }),
    payload({ stem: 'Which finding is NOT expected on the right after 50 mg/kg?' }),
    payload({ stem: 'Which finding is NOT expected on the right after -5.0 mg/kg?' }),
  ]) {
    const result = detector.compareDuplicateContent(base, changed);
    assert.equal(result.exact, false);
    assert.notEqual(result.sourceFingerprint, result.candidateFingerprint);
    assert.ok(result.score < detector.DUPLICATE_DETECTION_CONFIG.highConfidenceThreshold);
  }
});

void test('drug, answer, and same-concept wording differences are not exact duplicates', () => {
  const original = payload({
    stem: 'Which medication is the best initial therapy for this patient?',
    options: ['Aspirin', 'Clopidogrel', 'Warfarin', 'Heparin'],
    answer: 0,
    topic: 'Antithrombotic therapy',
  });
  const differentDrug = payload({
    stem: 'Which medication is the best initial therapy for this patient?',
    options: ['Metformin', 'Empagliflozin', 'Insulin', 'Semaglutide'],
    answer: 0,
    topic: 'Diabetes therapy',
  });
  const differentAnswer = { ...original, answer: 1 };
  const sameConceptDifferentQuestion = payload({
    stem: 'Which laboratory test is used to monitor therapeutic warfarin?',
    options: ['INR', 'aPTT', 'Bleeding time', 'Platelet count'],
    answer: 0,
    topic: 'Antithrombotic therapy',
  });

  for (const changed of [differentDrug, differentAnswer, sameConceptDifferentQuestion]) {
    const comparison = detector.compareDuplicateContent(original, changed);
    assert.equal(comparison.exact, false);
    assert.notEqual(comparison.sourceFingerprint, comparison.candidateFingerprint);
  }
  assert.equal(
    detector.detectDuplicateReview({
      incoming: original,
      qbankId: 'bank-a',
      candidates: [candidate('same-concept', sameConceptDifferentQuestion)],
    }),
    undefined,
  );
});

void test('detector ranks multiple approved and pending candidates and caps the result', () => {
  const incoming = payload();
  const candidates = [
    candidate('approved-1', incoming),
    candidate('pending-1', payload({ stem: `${incoming.stem} ` }), 'bank-a', 'pending_proposal'),
    candidate('approved-2', payload({ stem: incoming.stem.replace('65', '66') })),
    candidate('approved-3', incoming),
  ];
  const review = detector.detectDuplicateReview({ incoming, qbankId: 'bank-a', candidates, now: '2026-01-01T00:00:00.000Z' });
  assert.ok(review);
  assert.equal(review.detectorVersion, 'v1');
  assert.equal(review.candidates.length, detector.DUPLICATE_DETECTION_CONFIG.maximumCandidates);
  assert.equal(review.candidates[0].classification, 'exact');
  assert.ok(review.candidates.some((item) => item.entityType === 'pending_proposal'));
});

void test('same-QBank scope is enforced and unchanged KEEP BOTH pairs are suppressed', () => {
  const incoming = payload();
  const crossBank = candidate('other', incoming, 'bank-b');
  assert.equal(detector.detectDuplicateReview({ incoming, qbankId: 'bank-a', candidates: [crossBank] }), undefined);

  const local = candidate('local', incoming);
  const fingerprint = detector.duplicateFingerprint(incoming);
  const key = `proposal-1|${fingerprint}|approved_question|local|${fingerprint}`;
  assert.equal(detector.detectDuplicateReview({
    incoming,
    qbankId: 'bank-a',
    sourceEntityId: 'proposal-1',
    candidates: [local],
    suppressedPairs: new Set([key]),
  }), undefined);
  assert.ok(detector.detectDuplicateReview({
    incoming: payload({ stem: `${incoming.stem} Additional finding.` }),
    qbankId: 'bank-a',
    sourceEntityId: 'proposal-1',
    candidates: [local],
    suppressedPairs: new Set([key]),
  }));
});

void test('unrelated questions do not enter duplicate review', () => {
  const review = detector.detectDuplicateReview({
    incoming: payload(),
    qbankId: 'bank-a',
    candidates: [candidate('different', payload({
      stem: 'Which antibiotic treats uncomplicated cystitis?',
      options: ['Nitrofurantoin', 'Vancomycin', 'Amphotericin', 'Acyclovir'],
      answer: 0,
      specialty: 'Infectious diseases',
      topic: 'Urinary tract infection',
    }))],
  });
  assert.equal(review, undefined);
});

void test('representative large-bank import remains practical with prepared candidates', () => {
  const candidates = Array.from({ length: 5_000 }, (_, index) => candidate(`q-${index}`, payload({
    stem: `Patient ${index} presents with symptom ${index % 37}. Which management step is appropriate?`,
    topic: `Topic ${index % 40}`,
  })));
  candidates[4_999] = candidate('exact-last', payload());
  const started = performance.now();
  for (let index = 0; index < 20; index += 1)
    detector.detectDuplicateReview({ incoming: payload({ stem: index === 19 ? payload().stem : `Unique import question ${index} with finding ${index + 10000}` }), qbankId: 'bank-a', candidates });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 5_000, `20 questions against 5,000 candidates took ${Math.round(elapsed)}ms`);
});

void test('integration retains duplicates for review without automatic penalties', async () => {
  const platform = await readFile(new URL('../lib/platform-server.ts', import.meta.url), 'utf8');
  const collaboration = await readFile(new URL('../lib/cloudflare-server.ts', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../drizzle/0021_duplicate_review_system.sql', import.meta.url), 'utf8');
  const importPolicyMigration = await readFile(new URL('../drizzle/0022_question_level_import_deduplication.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(platform, /All valid questions were exact duplicates/);
  assert.doesNotMatch(platform, /exactFingerprints\.has/);
  assert.match(platform, /detectImportDuplication/);
  assert.doesNotMatch(platform, /recordConfirmedDuplicateAttempt/);
  assert.doesNotMatch(platform, /recordConfirmedDuplicateAttempt\([\s\S]{0,180}'file'/);
  assert.match(platform, /action === 'duplicate-resolve'/);
  assert.match(platform, /action === 'duplicate-scan'/);
  assert.match(platform, /Resolve possible duplicate cases with KEEP BOTH/);

  assert.match(collaboration, /detectDuplicateReview\(/);
  assert.match(migration, /duplicate_pair_decisions/);
  assert.match(migration, /duplicate_resolution_claims/);
  assert.match(migration, /UNIQUE INDEX `idx_duplicate_pair_decisions_unchanged_pair`/);
  assert.match(importPolicyMigration, /DROP INDEX IF EXISTS idx_imported_files_user_name/);
  assert.match(importPolicyMigration, /DROP INDEX IF EXISTS idx_imported_files_user_hash/);
});
