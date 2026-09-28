import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function serverEfficiencyApiTests(t, { db, call, mf, assets }) {
  const owner = 'preformed-owner';
  const questions = [{ id: randomUUID(), stem: 'Durable question', options: ['Correct', 'Other'], answer: 0, explanation: 'Original explanation', sourceReference: 'Original source', images: [] }];
  const create = async () => {
    const created = await call(owner, '/preformed/create', {});
    assert.equal(created.status, 201, JSON.stringify(created));
    const saved = await call(owner, '/preformed/save', { test: { ...created.data.test, title: 'Efficiency fixture', visibility: 'public', status: 'published', questions } }, 'PUT');
    assert.equal(saved.status, 200, JSON.stringify(saved));
    return saved.data.test;
  };

  await t.test('preformed results notify only owner and participant, with no catalog or duplicate-replay broadcast', async () => {
    const test = await create();
    const opened = await call('free', `/preformed/open?code=${test.code}`);
    assert.equal(opened.status, 200, JSON.stringify(opened));
    const sockets = [];
    const messages = [[], [], []];
    try {
      for (const [i, [uid, channel]] of [[owner, `user:${owner}`], ['free', 'user:free'], ['other', 'catalog']].entries()) {
        const response = await mf.dispatchFetch(`https://qraft.test/api/cloudflare/realtime?channel=${encodeURIComponent(channel)}`, {
          headers: { cookie: `__Host-qraft_session=fixture-${uid}`, origin: 'https://qraft.test', Upgrade: 'websocket' },
        });
        assert.equal(response.status, 101);
        response.webSocket.accept();
        response.webSocket.addEventListener('message', event => messages[i].push(JSON.parse(String(event.data))));
        sockets.push(response.webSocket);
      }
      const payload = { submissionId: randomUUID(), attemptToken: opened.data.test.attemptToken, answers: { [questions[0].id]: 0 } };
      assert.equal((await call('free', '/preformed/submit', payload)).status, 200);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.deepEqual(messages.map(items => items.length), [1, 1, 0]);
      assert.deepEqual(messages[0][0].resources, ['preformed-results']);
      assert.deepEqual(messages[1][0].resources, ['preformed-results']);
      const replay = await call('free', '/preformed/submit', payload);
      assert.equal(replay.data.duplicate, true);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.deepEqual(messages.map(items => items.length), [1, 1, 0]);
    } finally {
      sockets.forEach(socket => socket.close(1000, 'Test complete'));
      await call(owner, '/preformed/delete', { id: test.id }, 'DELETE');
    }
  });

  await t.test('stale and concurrent authoring cannot overwrite newer questions, explanation or images', async () => {
    const test = await create();
    try {
      const edit = suffix => ({ test: { ...test, title: `Title ${suffix}`, questions: [{ ...questions[0], explanation: `Explanation ${suffix}`, images: [{ id: randomUUID(), url: 'https://example.test/figure.png', name: 'Figure', caption: suffix }] }] } });
      const results = await Promise.all([call(owner, '/preformed/save', edit('one'), 'PUT'), call(owner, '/preformed/save', edit('two'), 'PUT')]);
      assert.deepEqual(results.map(item => item.status).sort((a, b) => a - b), [200, 409]);
      const winner = results.find(item => item.status === 200).data.test;
      const stale = await call(owner, '/preformed/save', { test }, 'PUT');
      assert.equal(stale.status, 409);
      const current = (await call(owner, `/preformed/manage?id=${test.id}`)).data.test;
      assert.deepEqual(current.questions, winner.questions);
      assert.equal(current.editRevision, winner.editRevision);
      // The DB guard rolls the whole transaction back, including any following
      // statement, even for a direct stale writer racing after the API read.
      await assert.rejects(db.batch([
        db.prepare('UPDATE preformed_tests SET title=?,edit_revision=? WHERE id=?').bind('stale', winner.editRevision, test.id),
        db.prepare('DELETE FROM preformed_tests WHERE id=?').bind(test.id),
      ]));
      assert.equal((await call(owner, `/preformed/manage?id=${test.id}`)).data.test.title, winner.title);
    } finally { await call(owner, '/preformed/delete', { id: test.id }, 'DELETE'); }
  });

  await t.test('images survive failed deletions; successful deletion durably queues media cleanup', async () => {
    const test = await create();
    const key = `questions/preformed-${test.id}/protected.png`;
    const now = new Date().toISOString();
    await assets.put(key, 'protected-image');
    await db.prepare("INSERT INTO media(key,qbank_id,owner_id,content_type,size,provider,storage_key,status,created_at,updated_at) VALUES(?,?,?,'image/png',15,'r2',?,'ready',?,?)")
      .bind(key, `preformed-${test.id}`, owner, key, now, now).run();
    await db.prepare(`CREATE TRIGGER efficiency_fail_delete BEFORE DELETE ON preformed_tests WHEN OLD.id='${test.id}' BEGIN SELECT RAISE(ABORT,'EFFICIENCY_FAILURE_FIXTURE'); END`).run();
    try {
      assert.equal((await call(owner, `/media/preformed-${test.id}`, {}, 'DELETE')).status, 409);
      assert.equal((await call(owner, '/preformed/delete', { id: test.id }, 'DELETE')).status, 500);
      assert.equal((await db.prepare('SELECT status FROM media WHERE key=?').bind(key).first()).status, 'ready');
      assert.ok(await assets.head(key));
      assert.equal((await call(owner, `/preformed/manage?id=${test.id}`)).status, 200);
    } finally { await db.prepare('DROP TRIGGER efficiency_fail_delete').run(); }
    assert.equal((await call(owner, '/preformed/delete', { id: test.id }, 'DELETE')).status, 200);
    const row = await db.prepare('SELECT status FROM media WHERE key=?').bind(key).first();
    assert.ok(!row || row.status === 'delete_pending');
    const response = await mf.dispatchFetch(`https://qraft.test/api/cloudflare/media/${key}`, { headers: { cookie: `__Host-qraft_session=fixture-${owner}` } });
    assert.equal(response.status, 404);
    await assets.delete(key);
    await db.prepare('DELETE FROM media WHERE key=?').bind(key).run();
  });
}
