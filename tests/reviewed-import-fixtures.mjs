import { build } from 'esbuild';
let compiled;
async function domain() {
  compiled ??= build({ stdin: { contents: "export {parseQuestionImportReport} from './lib/question-import'; export {withLocalImportMatches} from './features/imports/domain/local-import-duplicates'; export {duplicateFingerprint} from './features/duplicates/domain/duplicate-detection';", resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' }).then(result => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`));
  return compiled;
}

// Legacy API scenarios now model the explicit review that a real contributor
// completes in the workspace. Security tests send raw requests separately.
export async function reviewedImportFixture(call, uid, input) {
  if (input.requireDuplicateResolution !== undefined) return input;
  const next = { rightsConfirmed: true, ...input };
  if (next.duplicateChoices !== undefined) return next;
  const m = await domain();
  let report;
  try { report = m.parseQuestionImportReport(typeof next.questions === 'string' ? next.questions : { sourceFile: next.sourceFile, questions: next.questions }, '', 500); } catch { return next; }
  if (report.skipped.length || !report.questions.length) return next;
  const bankMatches = [];
  for (let offset = 0; offset < report.questions.length; offset += 25) {
    const preview = await call(uid, '/platform/import-preview', { qbankId: next.qbankId, questions: report.questions.slice(offset, offset + 25) });
    if (preview.status !== 200) return next;
    bankMatches.push(...preview.data.matches);
  }
  const matches = m.withLocalImportMatches(report.questions, bankMatches);
  return { ...next, duplicateChoices: matches.map((list, i) => list.length ? { sourceFingerprint: m.duplicateFingerprint(report.questions[i]), candidateFingerprints: list.map(match => match.candidateFingerprint) } : null) };
}

export async function seedLegacyFlaggedImport(db, response) {
  // Reviewer workflows still need coverage for unresolved proposals created
  // before mandatory author decisions. Seed that historical state directly.
  for (const proposal of response.data.proposals) {
    const row = await db.prepare("SELECT payload FROM records WHERE type='questionProposals' AND id=?").bind(proposal.id).first();
    const stored = JSON.parse(row.payload);
    if (stored.duplicateReview) { stored.duplicateReview.status = 'flagged'; delete stored.duplicateReview.resolutions;
      await db.prepare("UPDATE records SET payload=? WHERE type='questionProposals' AND id=?").bind(JSON.stringify(stored), stored.id).run();
    }
    Object.assign(proposal, stored);
  }
}
