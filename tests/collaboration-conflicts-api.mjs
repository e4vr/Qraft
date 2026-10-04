import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['server/db/collaboration-write-guard.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { collaborationWriteGuard } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

export async function collaborationConflictApiTests(t, { db, call }) {
  await t.test('proposal deletion accepts 500 then 114 operations, rejects 501 and leaves published questions intact', async () => {
    const id = `delete-batches-${randomUUID()}`, now = new Date().toISOString();
    const bank = { id, ownerId: 'admin', ownerName: 'Admin', name: 'Synthetic deletion batches', shortName: 'DELETE', description: '',
      createdById: 'admin', createdByName: 'Admin', createdAt: now, visibility: 'private', essential: false,
      archived: false, shareEnabled: false, reviewerIds: [], viewerIds: [] };
    const proposals = Array.from({ length: 614 }, (_, i) => ({ id: `${id}-${i}`, qbankId: id,
      type: 'new_question', status: i < 592 ? 'approved' : 'rejected', proposedById: 'admin',
      payload: { stem: `Synthetic proposal ${i}`, options: ['A', 'B'], answer: 0 },
    }));
    const created = await call('admin', '/qbanks', { bank });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    await db.prepare(`INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at)
      SELECT 'questionProposals',json_extract(value,'$.id'),?,'admin',value,? FROM json_each(?)`)
      .bind(id, now, JSON.stringify(proposals)).run();
    const count = async () => (await db.prepare("SELECT count(*) AS n FROM records WHERE type='questionProposals' AND qbank_id=?").bind(id).first()).n;
    const publishedBefore = (await db.prepare("SELECT count(*) AS n FROM records WHERE type='sharedQuestions'").first()).n;
    const current = await call('admin', '/collaboration');
    assert.equal(current.status, 200);
    const baseValues = new Map(current.data.collaboration.proposals.map(proposal => [proposal.id, proposal]));
    const operations = proposals.map(proposal => ({ collection: 'questionProposals', id: proposal.id, type: 'delete', baseValue: baseValues.get(proposal.id) }));
    try {
      assert.equal((await call('admin', '/collaboration', { operations: operations.slice(0, 501) }, 'PUT')).status, 400);
      assert.equal(await count(), 614);
      const first = await call('admin', '/collaboration', { operations: operations.slice(0, 500) }, 'PUT');
      assert.equal(first.status, 200, first.data.error);
      assert.equal(await count(), 114);
      const second = await call('admin', '/collaboration', { operations: operations.slice(500) }, 'PUT');
      assert.equal(second.status, 200, second.data.error);
      assert.equal(await count(), 0);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM records WHERE type='sharedQuestions'").first()).n, publishedBefore);
    } finally {
      await call('admin', `/qbanks/${id}`, undefined, 'DELETE');
    }
  });
  await t.test('concurrent bank edits have one winner, reject stale/missing bases and leave no guard rows', async () => {
    const id = `concurrent-bank-${randomUUID()}`;
    const bank = { id, ownerId: 'monthly', ownerName: 'monthly', name: 'Before', visibility: 'private', archived: false, essential: false };
    const set = (value, baseValue) => ({ collection: 'qbanks', id, type: 'set', value, baseValue });
    assert.equal((await call('monthly', '/collaboration', { operations: [set(bank, null)] }, 'PUT')).status, 200);
    try {
      const base = (await call('monthly', '/collaboration')).data.collaboration.qbanks.find(b => b.id === id);
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value;
      const baseHash = createHash('sha256').update(JSON.stringify(canonical(base))).digest('hex');
      const edits = await Promise.all(['First', 'Second'].map(name => call('monthly', '/collaboration', { operations: [{ collection: 'qbanks', id, type: 'set', value: { ...base, name }, baseHash }] }, 'PUT')));
      assert.deepEqual(edits.map(r => r.status).sort((a, b) => a - b), [200, 409]);
      const winning = (await call('monthly', '/collaboration')).data.collaboration.qbanks.find(b => b.id === id);
      assert.ok(['First', 'Second'].includes(winning.name));
      const stale = await call('monthly', '/collaboration', { operations: [set({ ...base, name: 'Stale' }, base)] }, 'PUT');
      assert.equal(stale.status, 409);
      const legacy = await call('monthly', '/collaboration', { operations: [{ collection: 'qbanks', id, type: 'set', value: { ...winning, name: 'Missing base' } }] }, 'PUT', { withBaseValues: false });
      assert.equal(legacy.status, 409);
      assert.equal(legacy.data.code, 'COLLABORATION_CONFLICT');
      assert.equal((await call('monthly', '/collaboration')).data.collaboration.qbanks.find(b => b.id === id).name, winning.name);
      assert.equal((await db.prepare('SELECT count(*) AS n FROM collaboration_write_guards').first()).n, 0);
      // Exercise the SQL assertion directly: the snapshot changed AFTER the
      // application read. Its following mutation must roll back as one batch.
      const payload = (await db.prepare("SELECT payload FROM records WHERE type='qbanks' AND id=?").bind(id).first()).payload;
      const saved = JSON.parse(payload);
      await db.prepare("UPDATE records SET payload=? WHERE type='qbanks' AND id=?").bind(JSON.stringify({ ...saved, name: 'Changed after read' }), id).run();
      await assert.rejects(db.batch([
        collaborationWriteGuard(db, [{ collection: 'qbanks', id, payload }], 'test-guard'),
        db.prepare("DELETE FROM records WHERE type='qbanks' AND id=?").bind(id),
      ]), /collaboration_snapshot_matches/);
      assert.equal(JSON.parse((await db.prepare("SELECT payload FROM records WHERE type='qbanks' AND id=?").bind(id).first()).payload).name, 'Changed after read');
      assert.equal((await db.prepare('SELECT count(*) AS n FROM collaboration_write_guards').first()).n, 0);
    } finally {
      const current = (await call('monthly', '/collaboration')).data.collaboration.qbanks.find(b => b.id === id);
      await call('monthly', '/collaboration', { operations: [{ collection: 'qbanks', id, type: 'delete', baseValue: current }] }, 'PUT');
    }
  });
}
