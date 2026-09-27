import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseResources, validateSourceConfigs } from './release-config.mjs';
import { npx, run } from './process.mjs';

export const cardinalities = Object.freeze({ small: 100, medium: 1000, 'production-like': 10000 });

// Synthetic scale scenarios, not a claim about the production database's actual size.
export function syntheticSql(size) {
  const count = cardinalities[size];
  if (!count) throw new Error('Choose small, medium, or production-like.');
  const prefix = `staging-scale-${size}`;
  const now = '2026-09-27T00:00:00.000Z';
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  const sql = ['PRAGMA foreign_keys=ON;'];
  const record = (type, value, bank, owner) => sql.push(`INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(${quote(type)},${quote(value.id)},${quote(bank)},${quote(owner)},${quote(JSON.stringify(value))},${quote(now)}) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at;`);
  for (let bank = 0; bank < 10; bank++) {
    const id = `${prefix}-bank-${bank}`;
    record('qbanks', { id, name: `Synthetic ${size} ${bank}`, shortName: 'Scale', description: 'Generated staging fixture', ownerId: 'staging-reviewer', ownerName: 'Staging Reviewer', createdById: 'staging-reviewer', createdByName: 'Staging Reviewer', visibility: 'private', reviewerIds: [], viewerIds: [], shareEnabled: true, essential: false, archived: false, createdAt: now }, id, 'staging-reviewer');
  }
  const scope = `${prefix}-bank-0`;
  record('qbankMemberships', { id: `${prefix}-member`, qbankId: scope, userId: 'staging-student', userName: 'Staging Student', role: 'viewer', grantedById: 'staging-reviewer', grantedByName: 'Staging Reviewer', createdAt: now }, scope, 'staging-student');
  const offset = size === 'small' ? 60000 : size === 'medium' ? 61000 : 70000;
  for (let i = 0; i < count; i++) {
    const bank = `${prefix}-bank-${i % 10}`;
    const questionId = String(offset + i);
    record('sharedQuestions', { id: `${prefix}-q-${i}`, questionId, qbankId: bank, number: offset + i, stem: `Generated ${size} validation question ${i}. Select the synthetic environment.`, options: ['Staging', 'Production', 'Archive', 'Billing'], answer: 0, answerLetter: 'A', explanation: 'Generated fixture; no patient or production user data.', specialty: 'Staging', topic: 'Scale', sourceFile: 'synthetic-scale-v1', sourcePage: 1, images: [], revision: 1, writtenById: 'staging-reviewer', writtenByName: 'Staging Reviewer' }, bank, 'staging-reviewer');
    if (i % 10 === 0) record('questionProposals', { id: `${prefix}-proposal-${i}`, qbankId: bank, type: 'new_question', status: 'pending', proposedById: 'staging-reviewer', proposedByName: 'Staging Reviewer', proposedAt: now, payload: { stem: `Generated scale proposal ${i}`, options: ['Staging', 'Production'], answer: 0, specialty: 'Staging', topic: 'Scale', explanation: 'Synthetic fixture' } }, bank, 'staging-reviewer');
  }
  return `${sql.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const size = process.argv[2];
  const path = resolve('.wrangler', 'synthetic', `${size}.sql`);
  const sql = syntheticSql(size);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, sql);
  console.log(`Generated ${size}: ${cardinalities[size]} questions, ${cardinalities[size] / 10} proposals, 10 private banks, 1 scoped membership. ${path}`);
  if (process.argv.includes('--apply-staging')) {
    validateSourceConfigs();
    run(npx, ['wrangler', 'd1', 'execute', releaseResources.staging.database, '--remote', '--env', 'staging', '--config', 'wrangler.jsonc', '--file', path]);
  }
}
