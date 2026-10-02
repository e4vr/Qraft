import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['features/collaboration/domain/collaboration-delta.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { applyCollaborationDelta } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const path = cursor => `/collaboration?since=${cursor.sequence}&syncUid=${encodeURIComponent(cursor.uid)}&syncScope=${cursor.scope}`;
const comparable = state => JSON.parse(JSON.stringify({ ...state, lastSyncAt: null }), (_, value) =>
  Array.isArray(value) && value.every(item => item && typeof item.id === 'string')
    ? value.sort((a, b) => a.id.localeCompare(b.id)) : value);

export async function collaborationDeltaApiTests(t, { db, call, mf }) {
  await t.test('import notifications reach authorized reviewers, retain legacy tabs, and only wake modern viewers for new classification', async () => {
    const id = `notify-import-${randomUUID()}`;
    const bank = { id, name: 'Notification fixture', shortName: 'NOTIFY', description: '',
      visibility: 'public', ownerId: 'admin', ownerName: 'Admin', essential: false,
      createdById: 'admin', createdByName: 'Admin', createdAt: new Date().toISOString(),
      shareEnabled: false, reviewerIds: [], viewerIds: [] };
    assert.equal((await call('admin', '/qbanks', { bank })).status, 200);
    const sockets = [];
    const connect = async (uid, channel, modern = true) => {
      const response = await mf.dispatchFetch(`https://qraft.test/api/cloudflare/realtime?channel=${encodeURIComponent(channel)}${modern ? '&v=2' : ''}`, {
        headers: { Upgrade: 'websocket', origin: 'https://qraft.test', cookie: `__Host-qraft_session=fixture-${uid}` },
      });
      assert.equal(response.status, 101);
      const socket = response.webSocket; socket.accept(); sockets.push(socket);
      const packets = [];
      socket.addEventListener('message', event => packets.push(JSON.parse(event.data)));
      return packets;
    };
    try {
      const denied = await mf.dispatchFetch(`https://qraft.test/api/cloudflare/realtime?channel=review:bank:${id}&v=2`, {
        headers: { Upgrade: 'websocket', origin: 'https://qraft.test', cookie: '__Host-qraft_session=fixture-monthly' },
      });
      assert.equal(denied.status, 403);
      const viewer = await connect('monthly', `bank:${id}`);
      const legacy = await connect('other', `bank:${id}`, false);
      const reviewer = await connect('reviewer', `review:bank:${id}`);
      const payload = { stem: 'Which treatment is NOT indicated at 0.5 mg?', options: ['A', 'B'], answer: 1, specialty: 'Medicine', topic: 'Treatment', explanation: '', sourceFile: 'Fixture.pdf', images: [] };
      const body = () => { const requestId = randomUUID(); return { requestId, qbankId: id, questions: [payload], fileName: `${requestId}.json`, fileHash: createHash('sha256').update(requestId).digest('hex'), rightsConfirmed: true }; };
      const first = body();
      assert.equal((await call('admin', '/platform/import', first)).status, 200);
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(viewer.length, 1);
      assert.deepEqual(viewer[0].resources, ['classification']);
      assert.equal(legacy.some(packet => packet.resources.includes('review-queue')), true);
      assert.equal(reviewer.length, 1);
      assert.ok(reviewer[0].resources.includes('review-queue'));
      assert.equal((await call('admin', '/platform/import', body())).status, 200);
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(viewer.length, 1);
      assert.equal(reviewer.length, 2);
      const legacyCount = legacy.length;
      assert.equal((await call('admin', '/platform/import', first)).status, 200);
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(reviewer.length, 2);
      assert.equal(legacy.length, legacyCount);
      assert.equal(viewer.length, 1);
      const concurrentPayload = { ...payload, stem: `${payload.stem} Case ${randomUUID()}.` };
      const concurrent = [body(), body()].map(input => ({ ...input, questions: [concurrentPayload], skipExactDuplicates: true }));
      const outcomes = await Promise.all(concurrent.map(input => call('admin', '/platform/import', input)));
      for (let index = 0; index < outcomes.length; index++) {
        if (outcomes[index].status === 409) {
          assert.equal(outcomes[index].data.code, 'IMPORT_SEARCH_CONFLICT');
          outcomes[index] = await call('admin', '/platform/import', concurrent[index]);
        }
        assert.equal(outcomes[index].status, 200, JSON.stringify(outcomes[index]));
      }
      assert.equal(outcomes.reduce((sum, outcome) => sum + outcome.data.successful, 0), 1);
      assert.equal(outcomes.reduce((sum, outcome) => sum + outcome.data.skippedDuplicates, 0), 1);
      assert.equal(await db.prepare("SELECT count(*) FROM records WHERE type='questionProposals' AND qbank_id=? AND json_extract(payload,'$.payload.stem')=?")
        .bind(id, concurrentPayload.stem).first('count(*)'), 1);
      assert.equal(await db.prepare('SELECT count(*) FROM import_search_guards').first('count(*)'), 0);
    } finally {
      sockets.forEach(socket => socket.close());
      await call('admin', `/qbanks/${id}`, undefined, 'DELETE');
    }
  });

  await t.test('delta snapshots match full reads after edits, deletions and pending review, and isolate private banks', async () => {
    const id = `delta-${randomUUID()}`, now = new Date().toISOString();
    const bank = { id, name: 'Delta bank', ownerId: 'admin', visibility: 'private', essential: false };
    const put = async (type, value, owner = null) => db.prepare('INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload')
      .bind(type, value.id, type === 'qbanks' ? null : id, owner, JSON.stringify(value), now).run();
    await put('qbanks', bank);
    await put('qbankMemberships', { id: `${id}-viewer`, qbankId: id, userId: 'monthly', role: 'viewer' });
    const question = { id: `${id}-question`, qbankId: id, questionId: '99888', stem: 'Which drug is NOT indicated at 0.5 mg?', options: ['A', 'B'], answer: 0, revision: 1 };
    await put('sharedQuestions', question);
    const initial = (await call('monthly', '/collaboration')).data;
    const adminInitial = (await call('admin', '/collaboration')).data;
    const outsider = (await call('other', '/collaboration')).data;
    await put('sharedQuestions', { ...question, answer: 1, revision: 2 });
    const proposal = { id: `${id}-proposal`, qbankId: id, status: 'pending', proposedById: 'admin', payload: { ...question, answer: 1 } };
    await put('questionProposals', proposal, 'admin');
    await put('sharedNotes', { id: `${id}-note`, qbankId: id, questionId: question.id, text: 'Changed note' });
    for (const [uid, base] of [['monthly', initial], ['admin', adminInitial], ['other', outsider]]) {
      const delta = await call(uid, path(base.cursor));
      assert.equal(delta.status, 200);
      assert.ok(delta.data.delta, JSON.stringify(delta.data));
      assert.deepEqual(comparable(applyCollaborationDelta(base.collaboration, delta.data.delta)), comparable((await call(uid, '/collaboration')).data.collaboration));
      if (uid !== 'admin') assert.equal(delta.data.delta.changes.proposals.length, 0);
      if (uid === 'other') assert.equal(JSON.stringify(delta.data).includes(id), false);
    }
    const current = (await call('monthly', '/collaboration')).data;
    await db.prepare("DELETE FROM records WHERE type='sharedQuestions' AND id=?").bind(question.id).run();
    const deletion = (await call('monthly', path(current.cursor))).data;
    assert.ok(deletion.delta.removed.some(row => row.id === question.id));
    const merged = applyCollaborationDelta(current.collaboration, deletion.delta);
    assert.equal(merged.approvedQuestions.some(row => row.id === question.id), false);
    assert.deepEqual(comparable(merged), comparable((await call('monthly', '/collaboration')).data.collaboration));
    // An old/repeated hint can replay the same delta without resurrecting data.
    assert.deepEqual(comparable(applyCollaborationDelta(merged, deletion.delta)), comparable(merged));
    const beforeRevocation = (await call('monthly', '/collaboration')).data;
    await db.prepare("DELETE FROM records WHERE type='qbankMemberships' AND id=?").bind(`${id}-viewer`).run();
    const revoked = (await call('monthly', path(beforeRevocation.cursor))).data;
    assert.ok(revoked.collaboration);
    assert.equal(revoked.collaboration.qbanks.some(row => row.id === id), false);
    const wrongAccount = (await call('admin', path(beforeRevocation.cursor))).data;
    assert.ok(wrongAccount.collaboration);
    const future = (await call('admin', path({ ...wrongAccount.cursor, sequence: wrongAccount.cursor.sequence + 1000 }))).data;
    assert.ok(future.collaboration);
    await db.prepare('DELETE FROM records WHERE qbank_id=? OR (type=\'qbanks\' AND id=?)').bind(id, id).run();
  });

  await t.test('legacy key backfill is indexed, account protected, and does not change question content', async () => {
    const id = `zz-legacy-${randomUUID()}`;
    const payload = JSON.stringify({ id, qbankId: 'smle-gs', questionId: '99890', stem: 'Which dose is NOT indicated at 0.5 mg?', options: ['A', 'B'], answer: 1 });
    await db.prepare("INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES('sharedQuestions',?,'smle-gs',?,'now')").bind(id, payload).run();
    assert.equal(await db.prepare('SELECT count(*) FROM import_question_keys WHERE record_id=?').bind(id).first('count(*)'), 0);
    assert.equal((await call('monthly', '/platform/import-search-reindex', {})).status, 403);
    assert.equal((await call('admin', '/platform/import-search-reindex', { collection: 'auditLog' })).status, 400);
    assert.equal((await call('admin', '/platform/import-search-reindex', { cursor: 10 })).status, 400);
    const response = await call('admin', '/platform/import-search-reindex', { collection: 'sharedQuestions', cursor: 'zz-legacy-' });
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.data.collection, 'questionProposals');
    assert.equal(response.data.cursor, '');
    assert.equal(await db.prepare('SELECT count(*) FROM import_question_keys WHERE record_id=?').bind(id).first('count(*)'), 1);
    assert.equal(await db.prepare("SELECT payload FROM records WHERE type='sharedQuestions' AND id=?").bind(id).first('payload'), payload);
    await db.prepare("DELETE FROM records WHERE type='sharedQuestions' AND id=?").bind(id).run();
  });

  await t.test('expired journal cursors recover with a full authorized snapshot', async () => {
    const base = (await call('admin', '/collaboration')).data;
    for (let i = 0; i < 3; i++) await db.prepare("INSERT INTO collaboration_changes(collection,record_id) VALUES('sharedQuestions',?)").bind(`expired-${i}`).run();
    await db.prepare('DELETE FROM collaboration_changes WHERE sequence<=?').bind(base.cursor.sequence + 1).run();
    const recovered = (await call('admin', path(base.cursor))).data;
    assert.ok(recovered.collaboration);
    assert.ok(recovered.cursor.sequence > base.cursor.sequence);
  });

  await t.test('bank creation, visibility changes and deletion refresh only affected bank data', async () => {
    const id = `catalog-delta-${randomUUID()}`, now = new Date().toISOString();
    const base = (await call('monthly', '/collaboration')).data;
    const bank = { id, name: 'Catalog delta', ownerId: 'admin', visibility: 'public', essential: false };
    const writeBank = value => db.prepare("INSERT INTO records(type,id,payload,updated_at) VALUES('qbanks',?,?,?) ON CONFLICT(type,id) DO UPDATE SET payload=excluded.payload")
      .bind(id, JSON.stringify(value), now).run();
    await writeBank(bank);
    const created = (await call('monthly', path(base.cursor))).data;
    assert.ok(created.delta);
    assert.deepEqual(created.delta.resetBanks, [id]);
    assert.equal(created.delta.changes.approvedQuestions.length, 0);
    assert.deepEqual(comparable(applyCollaborationDelta(base.collaboration, created.delta)), comparable((await call('monthly', '/collaboration')).data.collaboration));
    const question = { id: `${id}-q`, qbankId: id, questionId: '99889', stem: 'A new bank question', options: ['A', 'B'], answer: 0 };
    await db.prepare("INSERT INTO records(type,id,qbank_id,payload,updated_at) VALUES('sharedQuestions',?,?,?,?)")
      .bind(question.id, id, JSON.stringify(question), now).run();
    const publicBase = (await call('monthly', '/collaboration')).data;
    await writeBank({ ...bank, visibility: 'private' });
    const privateChange = (await call('monthly', path(publicBase.cursor))).data;
    assert.ok(privateChange.delta);
    const revoked = applyCollaborationDelta(publicBase.collaboration, privateChange.delta);
    assert.equal(revoked.approvedQuestions.some(row => row.id === question.id), false);
    assert.deepEqual(comparable(revoked), comparable((await call('monthly', '/collaboration')).data.collaboration));
    await writeBank(bank);
    const granted = (await call('monthly', path(privateChange.delta.cursor))).data;
    assert.ok(granted.delta);
    assert.equal(granted.delta.changes.approvedQuestions.length, 1);
    const restored = applyCollaborationDelta(revoked, granted.delta);
    assert.deepEqual(comparable(restored), comparable((await call('monthly', '/collaboration')).data.collaboration));
    await db.prepare("DELETE FROM records WHERE qbank_id=? OR (type='qbanks' AND id=?)").bind(id, id).run();
    const deleted = (await call('monthly', path(granted.delta.cursor))).data;
    assert.ok(deleted.delta);
    assert.equal(applyCollaborationDelta(restored, deleted.delta).approvedQuestions.some(row => row.id === question.id), false);
    assert.deepEqual(comparable(applyCollaborationDelta(restored, deleted.delta)), comparable((await call('monthly', '/collaboration')).data.collaboration));
  });
}
