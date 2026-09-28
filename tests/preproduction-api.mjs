import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function preproductionApiTests(t, { db, call }) {
  await t.test('ticket retries restore the complete UI response without duplicate messages', async () => {
    const draft = { title: 'Retry contract fixture', body: 'A retained support draft.', requestId: randomUUID() };
    const created = await call('other', '/contact', draft);
    assert.equal(created.status, 200);
    const replay = await call('other', '/contact', draft);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.data.ticket, created.data.ticket);
    assert.deepEqual(replay.data.message, created.data.message);
    assert.equal(replay.data.unchanged, true);
    const id = created.data.id;
    await call('admin', '/contact', { id, operation: 'status', status: 'in_progress' });
    const reply = { id, body: 'Requested clarification.', requestId: randomUUID() };
    const saved = await call('other', '/contact', reply);
    assert.equal(saved.status, 200);
    await call('admin', '/contact', { id, operation: 'status', status: 'resolved' });
    const delayedReplay = await call('other', '/contact', reply);
    assert.equal(delayedReplay.status, 200, JSON.stringify(delayedReplay));
    assert.equal(delayedReplay.data.ticket.status, 'resolved');
    assert.deepEqual(delayedReplay.data.message, saved.data.message);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM ticket_messages WHERE ticket_id=?').bind(id).first()).n, 2);
    assert.equal((await call('lite', '/contact', draft)).status, 409);
    assert.equal((await call('other', '/contact', { ...draft, body: 'Different content' })).status, 409);
    const other = await call('other', '/contact', { ...draft, requestId: randomUUID() });
    assert.equal((await call('other', '/contact', { ...reply, id: other.data.id })).status, 409);
  });
}
