import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['server/db/collaboration-write-guard.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { collaborationWriteGuard } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

export async function collaborationConflictApiTests(t, { db, call }) {
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
