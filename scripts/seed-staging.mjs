import { pbkdf2Sync } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseResources, validateSourceConfigs } from './release-config.mjs';
import { npx, run } from './process.mjs';

validateSourceConfigs();
const target = releaseResources.staging;
if (target.database === releaseResources.production.database || target.databaseId === releaseResources.production.databaseId)
  throw new Error('Refusing to seed: staging resolves to a production D1 resource.');

function localPassword() {
  if (process.env.QRAFT_STAGING_SEED_PASSWORD) return process.env.QRAFT_STAGING_SEED_PASSWORD;
  if (!existsSync('.dev.vars.staging')) return '';
  const line = readFileSync('.dev.vars.staging', 'utf8').split(/\r?\n/)
    .find(value => value.startsWith('QRAFT_STAGING_SEED_PASSWORD='));
  return line?.slice(line.indexOf('=') + 1) ?? '';
}

const password = localPassword();
if (password.length < 24)
  throw new Error('Set QRAFT_STAGING_SEED_PASSWORD (24+ characters), or run staging-secrets.mjs prepare.');
const now = '2026-09-24T00:00:00.000Z';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => quote(JSON.stringify(value));
/** @type {Array<[string, string, string, string[]]>} */
const accounts = [
  ['staging-owner', 'owner@staging.qraft.invalid', 'Staging Owner', []],
  ['staging-reviewer', 'reviewer@staging.qraft.invalid', 'Staging Reviewer', ['reviewer']],
  ['staging-student', 'student@staging.qraft.invalid', 'Staging Student', []],
];
const statements = ['PRAGMA foreign_keys=ON;'];
for (const [uid, email, displayName, platformRoles] of accounts) {
  const salt = `qraft-staging-seed-v1:${uid}`;
  const hash = pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');
  const profile = { uid, email, displayName, phone: '0500000000', universityId: `STAGING-${uid}`, tier: 'pro', status: 'approved', role: 'student', platformRoles, createdAt: now };
  statements.push(`INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,created_at,updated_at) VALUES(${quote(uid)},${quote(email)},${quote(hash)},${quote(salt)},${json(profile)},${quote(now)},${quote(now)}) ON CONFLICT(uid) DO UPDATE SET email=excluded.email,password_hash=excluded.password_hash,password_salt=excluded.password_salt,profile_json=excluded.profile_json,updated_at=excluded.updated_at;`);
  statements.push(`INSERT INTO subscriptions(user_id,status,starts_at,expires_at,method,paid,updated_at,plan) VALUES(${quote(uid)},'active',${quote(now)},'2030-01-01T00:00:00.000Z','staging-seed',0,${quote(now)},'pro') ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,expires_at=excluded.expires_at,updated_at=excluded.updated_at,plan=excluded.plan;`);
}

const banks = [
  { id: 'staging-public-bank', name: 'Synthetic Public Bank', shortName: 'Public', description: 'Synthetic staging data', ownerId: 'staging-owner', ownerName: 'Staging Owner', createdById: 'staging-owner', createdByName: 'Staging Owner', visibility: 'public', reviewerIds: [], viewerIds: [], shareEnabled: true, essential: false, archived: false, createdAt: now },
  { id: 'staging-private-bank', name: 'Synthetic Private Bank', shortName: 'Private', description: 'Synthetic staging data', ownerId: 'staging-owner', ownerName: 'Staging Owner', createdById: 'staging-owner', createdByName: 'Staging Owner', visibility: 'private', reviewerIds: [], viewerIds: [], shareEnabled: true, essential: false, archived: false, createdAt: now },
];
function upsertRecord(type, value, qbankId, ownerId = null) {
  statements.push(`INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(${quote(type)},${quote(value.id)},${quote(qbankId)},${ownerId ? quote(ownerId) : 'NULL'},${json(value)},${quote(now)}) ON CONFLICT(type,id) DO UPDATE SET qbank_id=excluded.qbank_id,owner_id=excluded.owner_id,payload=excluded.payload,updated_at=excluded.updated_at;`);
}
for (const bank of banks) upsertRecord('qbanks', bank, bank.id, bank.ownerId);
upsertRecord('qbankMemberships', { id: 'staging-private-reviewer', qbankId: 'staging-private-bank', userId: 'staging-reviewer', userName: 'Staging Reviewer', role: 'editor', grantedById: 'staging-owner', grantedByName: 'Staging Owner', createdAt: now }, 'staging-private-bank', 'staging-reviewer');
upsertRecord('qbankMemberships', { id: 'staging-private-student', qbankId: 'staging-private-bank', userId: 'staging-student', userName: 'Staging Student', role: 'viewer', grantedById: 'staging-owner', grantedByName: 'Staging Owner', createdAt: now }, 'staging-private-bank', 'staging-student');

const questions = [
  ['staging-q-001', '99001', 'staging-public-bank', 'A patient has reproducible synthetic chest discomfort. Which first test is appropriate?', ['ECG', 'MRI', 'Biopsy', 'No test'], 0],
  ['staging-q-002', '99002', 'staging-public-bank', 'A synthetic patient has reproducible chest discomfort. What initial test is appropriate?', ['ECG', 'MRI', 'Biopsy', 'No test'], 0],
  ['staging-q-003', '99003', 'staging-private-bank', 'Which environment contains only generated validation data?', ['Production', 'Staging', 'Archive', 'Billing'], 1],
];
for (const [id, questionId, qbankId, stem, options, answer] of questions) {
  statements.push(`INSERT OR IGNORE INTO question_ids(question_id,qbank_id,created_by_id,created_at) VALUES(${quote(questionId)},${quote(qbankId)},'staging-owner',${quote(now)});`);
  upsertRecord('sharedQuestions', { id, questionId, qbankId, number: Number(questionId), stem, options, answer, answerLetter: String.fromCharCode(65 + answer), explanation: 'Synthetic staging fixture.', specialty: 'Staging', topic: 'Validation', sourceFile: 'synthetic-seed', sourcePage: 1, images: [], revision: 1, writtenById: 'staging-owner', writtenByName: 'Staging Owner' }, qbankId, 'staging-owner');
}
upsertRecord('questionProposals', { id: 'staging-proposal-001', qbankId: 'staging-public-bank', type: 'new_question', status: 'pending', proposedById: 'staging-student', proposedByName: 'Staging Student', proposedAt: now, payload: { stem: 'Which validation environment is isolated from production?', options: ['Staging', 'Production'], answer: 0, specialty: 'Staging', topic: 'Validation', explanation: 'Synthetic review fixture.', sourceReference: 'synthetic-seed' } }, 'staging-public-bank', 'staging-student');
const state = { version: 1, qbanks: [], tests: [{ id: 'staging-exam-001', title: 'Synthetic smoke exam', mode: 'practice', qbankId: 'staging-public-bank', questionIds: ['staging-q-001', 'staging-q-002'], currentIndex: 0, answers: {}, revealed: [], graded: [], startedAt: now, updatedAt: now, status: 'active' }], updatedAt: now };
statements.push(`INSERT INTO app_states(user_id,payload,updated_at) VALUES('staging-student',${json(state)},${quote(now)}) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at;`);
statements.push(`INSERT INTO test_registry(user_id,test_id,question_count,started_at) VALUES('staging-student','staging-exam-001',2,${quote(now)}) ON CONFLICT(user_id,test_id) DO UPDATE SET question_count=excluded.question_count,started_at=excluded.started_at;`);

const path = join(tmpdir(), `qraft-staging-seed-${process.pid}.sql`);
try {
  writeFileSync(path, `${statements.join('\n')}\n`, { mode: 0o600 });
  run(npx, ['wrangler', 'd1', 'execute', target.database, '--remote', '--env', 'staging', '--config', 'wrangler.jsonc', '--file', path]);
  run(npx, ['wrangler', 'd1', 'execute', target.database, '--remote', '--env', 'staging', '--config', 'wrangler.jsonc', '--command', "SELECT (SELECT count(*) FROM profiles WHERE email LIKE '%@staging.qraft.invalid') AS accounts,(SELECT count(*) FROM records WHERE id LIKE 'staging-%') AS records,(SELECT count(*) FROM test_registry WHERE test_id='staging-exam-001') AS exams;"]);
  console.log('Deterministic synthetic staging seed applied.');
} finally {
  rmSync(path, { force: true });
}
