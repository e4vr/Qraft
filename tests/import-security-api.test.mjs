import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { unstable_splitSqlQuery } from 'wrangler';
import { createHash, randomUUID } from 'node:crypto';
import { seedFullAccess } from './access-fixtures.mjs';

await test('import privacy, mandatory gates and proposal images work together without privilege escalation', async () => {
  mkdirSync('.ui-review', { recursive: true });
  await build({ stdin: { contents: "export {RealtimeChannel} from './workers/realtime.ts';import {GET,POST,PUT,DELETE} from './app/api/cloudflare/[...path]/route.ts';export default {fetch(request){return ({GET,POST,PUT,DELETE})[request.method](request)}}", resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], outfile: '.ui-review/import-security-api-worker.mjs' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: '.ui-review/import-security-api-worker.mjs', compatibilityDate: '2026-09-09', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'isolated-import-security' }, r2Buckets: { ASSETS: 'isolated-import-assets' }, durableObjects: { REALTIME: { className: 'RealtimeChannel', useSQLite: true } }, bindings: { ROOT_ADMIN_EMAIL: 'root@example.invalid', BACKUP_SIGNING_KEY: 'isolated-import-test-signing-key-not-for-production' } }));
  try {
    const db = await mf.getD1Database('DB');
    for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) for (const sql of unstable_splitSqlQuery(readFileSync(`drizzle/${name}`, 'utf8'))) await db.prepare(sql).run();
    const now = new Date().toISOString();
    for (const uid of ['reader', 'author', 'observer']) {
      const profile = { uid, email: `${uid}@example.invalid`, displayName: uid, tier: 'free', role: 'student', platformRoles: [], status: 'approved', phone: 'synthetic', universityId: 'synthetic', createdAt: now };
      await db.prepare('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)').bind(uid, profile.email, 'unused', 'unused', JSON.stringify(profile), null, now, now).run();
      await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)').bind(createHash('sha256').update(`session-${uid}`).digest('hex'), uid, Math.floor(Date.now() / 1000) + 3600, now).run();
      await seedFullAccess(db, uid);
    }
    const bank = { id: 'security-bank', name: 'Synthetic bank', ownerId: 'author', createdById: 'author', visibility: 'public', reviewerIds: [], viewerIds: [], essential: false, archived: false, createdAt: now };
    await db.prepare("INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES('qbanks',?,?,?,?,?)").bind(bank.id, bank.id, bank.ownerId, JSON.stringify(bank), now).run();
    for (const [type, item] of [
      ['qbankSpecialties', { id: 'safety-specialty', qbankId: bank.id, name: 'Cardiology' }],
      ['qbankTopics', { id: 'safety-topic', qbankId: bank.id, specialtyId: 'safety-specialty', name: 'Heart failure' }],
      ['qbankSpecialties', { id: 'other-bank-specialty', qbankId: 'other-bank', name: 'Hidden other bank taxonomy' }],
    ]) await db.prepare('INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?)').bind(type, item.id, item.qbankId, 'author', JSON.stringify(item), now).run();
    const question = { stem: 'Which synthetic option is appropriate for this security scenario?', options: ['First', 'Second'], answer: 0, sourceFile: 'Synthetic source.pdf', specialty: 'General', topic: 'Audit', explanation: 'Private unapproved explanation', images: [] };
    const proposal = { id: randomUUID(), qbankId: bank.id, type: 'new_question', status: 'pending', proposedById: 'author', proposedByName: 'Private author', proposedAt: now, payload: question };
    await db.prepare("INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES('questionProposals',?,?,?,?,?)").bind(proposal.id, bank.id, proposal.proposedById, JSON.stringify(proposal), now).run();
    const headers = uid => ({ cookie: `__Host-qraft_session=session-${uid}`, origin: 'https://security.test', 'content-type': 'application/json', 'x-qraft-account': uid });
    const call = async (path, body, uid = 'reader') => { const response = await mf.dispatchFetch(`https://security.test/api/cloudflare${path}`, { method: body ? 'POST' : 'GET', headers: headers(uid), ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() }; };
    const incoming = { ...question, explanation: 'Reader own explanation' };
    const collaboration = await call('/collaboration'); assert.equal(JSON.stringify(collaboration.data).includes(proposal.id), false);
    const preview = await call('/platform/import-preview', { qbankId: bank.id, questions: [incoming], includePolicy: true }); assert.equal(preview.status, 200);
    assert.deepEqual(preview.data.classifications, { specialties: ['Cardiology'], topics: [{ specialty: 'Cardiology', name: 'Heart failure' }] });
    const hidden = preview.data.matches[0][0]; assert.equal(hidden.restricted, true); assert.equal(hidden.payload, undefined);
    assert.equal(hidden.similarity, 0); assert.equal(hidden.classification, 'possible', 'private answers cannot be inferred from a precise similarity score');
    const probes = await call('/platform/import-preview', { qbankId: bank.id, questions: [0, 1].map(answer => ({ ...incoming, answer, stem: incoming.stem.replace('scenario', 'situation') })) });
    assert.equal(probes.status, 200);
    assert.ok(probes.data.matches.every(matches => matches[0]?.restricted && matches[0].similarity === 0 && matches[0].classification === 'possible'));
    assert.equal(JSON.stringify(preview.data).includes(question.explanation), false); assert.equal(JSON.stringify(preview.data).includes(proposal.id), false);
    const ownerPreview = await call('/platform/import-preview', { qbankId: bank.id, questions: [incoming] }, 'author'); assert.equal(ownerPreview.data.matches[0][0].payload.explanation, question.explanation);
    assert.equal(ownerPreview.data.classifications, undefined, 'later chunks do not reload taxonomy');
    assert.equal((await call('/platform/import-preview', { qbankId: 'private-unavailable', questions: [incoming] })).status, 403);
    const csrf = await mf.dispatchFetch('https://security.test/api/cloudflare/platform/import-preview', { method: 'POST', headers: { ...headers('reader'), origin: 'https://evil.invalid' }, body: JSON.stringify({ qbankId: bank.id, questions: [incoming] }) }); assert.equal(csrf.status, 403);
    const changed = await mf.dispatchFetch('https://security.test/api/cloudflare/platform/import-preview', { method: 'POST', headers: { ...headers('reader'), 'x-qraft-account': 'author' }, body: JSON.stringify({ qbankId: bank.id, questions: [incoming] }) }); assert.equal(changed.status, 409);
    const upload = async (kind, qbankId = bank.id, questionId = `import-${randomUUID()}`) => {
      const form = new FormData(); form.append('file', new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'synthetic.png', { type: 'image/png' })); form.append('qbankId', qbankId); form.append('questionId', questionId);
      const encoded = new Request('https://security.test/body', { method: 'POST', body: form });
      const response = await mf.dispatchFetch(`https://security.test/api/cloudflare/media/${kind}`, { method: 'POST', headers: { cookie: headers('reader').cookie, origin: 'https://security.test', 'content-type': encoded.headers.get('content-type') }, body: await encoded.arrayBuffer() });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await upload('questions')).status, 403, 'published-question edit permission stays restricted');
    const image = await upload('proposals'); assert.equal(image.status, 201, JSON.stringify(image)); assert.match(image.data.url, /media\/proposals\//);
    const imageRead = uid => mf.dispatchFetch(`https://security.test${image.data.url}`, { headers: headers(uid) });
    const ownImage = await imageRead('reader'); assert.equal(ownImage.status, 200); assert.equal(ownImage.headers.get('cache-control'), 'private, no-store');
    assert.equal((await imageRead('author')).status, 200, 'reviewer can inspect private proposal images');
    assert.equal((await imageRead('observer')).status, 403, 'knowing a private proposal image URL does not grant access');
    const publishedId = randomUUID();
    await db.prepare("INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES('sharedQuestions',?,?,?,?,?)").bind(publishedId, bank.id, 'author', JSON.stringify({ ...question, id: publishedId, questionId: '98765', qbankId: bank.id, stem: 'Published image permission fixture', images: [{ id: 'approved-image', url: image.data.url, name: 'Image', caption: '' }] }), now).run();
    assert.equal((await imageRead('observer')).status, 200, 'bank readers can view the image after a question containing it is approved');
    assert.equal((await upload('proposals', 'private-unavailable')).status, 403); assert.equal((await upload('proposals', bank.id, 'published-question-id')).status, 403);
    const meta = { qbankId: bank.id, requestId: randomUUID(), fileName: 'synthetic.json', fileHash: 'a'.repeat(64), questions: [incoming] };
    assert.equal((await call('/platform/import', { ...meta, requireDuplicateResolution: false })).data.code, 'RIGHTS_CONFIRMATION_REQUIRED');
    const unresolved = await call('/platform/import', { ...meta, rightsConfirmed: true, requireDuplicateResolution: false }); assert.equal(unresolved.status, 409);
    assert.equal(unresolved.data.matches[0].restricted, true); assert.equal(unresolved.data.matches[0].payload, undefined); assert.equal(JSON.stringify(unresolved.data).includes(question.explanation), false);
    assert.equal(unresolved.data.matches[0].candidateFingerprint, hidden.candidateFingerprint, 'opaque decisions remain stable for this account');
    const { duplicateFingerprint } = await import('../.ui-review/import-security-fingerprint.mjs').catch(async () => {
      await build({ stdin: { contents: "export {duplicateFingerprint} from './features/duplicates/domain/duplicate-detection';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: '.ui-review/import-security-fingerprint.mjs' });
      return import('../.ui-review/import-security-fingerprint.mjs');
    });
    const forged = await call('/platform/import', { ...meta, requestId: randomUUID(), rightsConfirmed: true, duplicateChoices: [{ sourceFingerprint: duplicateFingerprint(incoming), candidateFingerprints: [duplicateFingerprint(question)] }] }); assert.equal(forged.status, 409);
    const request = { ...meta, requestId: randomUUID(), rightsConfirmed: true, duplicateChoices: [{ sourceFingerprint: duplicateFingerprint(incoming), candidateFingerprints: [hidden.candidateFingerprint] }] };
    const accepted = await call('/platform/import', request); assert.equal(accepted.status, 200, JSON.stringify(accepted)); assert.equal(accepted.data.successful, 1); assert.equal(accepted.data.proposals[0].duplicateReview.status, 'resolved');
    assert.equal(JSON.stringify(accepted.data).includes(proposal.id), false, 'submission acknowledgements must not reveal private evidence');
    const ownView = await call('/collaboration'); assert.equal(JSON.stringify(ownView.data).includes(proposal.id), false, 'author collaboration views must not reveal private evidence');
    const count = async () => (await db.prepare("SELECT count(*) n FROM records WHERE type='questionProposals' AND owner_id='reader'").first()).n;
    const before = await count(); assert.equal((await call('/platform/import', request)).status, 200); assert.equal(await count(), before);
    assert.equal((await call('/platform/import', { ...request, qbankId: 'different-bank' })).data.code, 'IMPORT_BANK_MISMATCH');
    assert.equal((await call('/platform/import', { ...request, questions: [{ ...incoming, explanation: 'Changed backup content' }] })).data.code, 'IMPORT_CONTENT_MISMATCH');
    const invalid = await call('/platform/import', { ...meta, requestId: randomUUID(), rightsConfirmed: true, questions: [incoming, { ...incoming, options: [] }], requireDuplicateResolution: false }); assert.equal(invalid.status, 400); assert.equal(invalid.data.code, 'INVALID_IMPORT_QUESTIONS'); assert.equal(await count(), before);
  } finally { await mf.dispose(); }
});
