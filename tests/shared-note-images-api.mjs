import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function sharedNoteImageApiTests(t, { db, call, mf, uploadImage }) {
  await t.test('shared explanation photos work for Free accounts, retain bank privacy and preserve private-note restrictions', async () => {
    const usage = await db.prepare('SELECT * FROM r2_usage_periods').all();
    const storedBytes = await db.prepare("SELECT value FROM counters WHERE id='r2-storage-bytes'").first();
    const beforeMedia = await db.prepare('SELECT key FROM media').all();
    const beforeKeys = new Set(beforeMedia.results.map(row => row.key));
    const noteKey = 'smle-gs:gs-002';
    const beforeNote = await db.prepare("SELECT * FROM records WHERE type='sharedNotes' AND id=?").bind(noteKey).first();
    const bankId = `shared-image-private-${randomUUID()}`;
    const freePolicy = await db.prepare("SELECT policy_json FROM plan_prices WHERE plan='free'").first();
    try {
      await db.prepare('DELETE FROM r2_usage_periods').run();
      const response = await uploadImage('free', 'shared.png', 'shared-free-image', 'shared-notes');
      assert.equal(response.status, 201, await response.clone().text());
      const { url } = await response.json();
      assert.match(url, /\/media\/shared-notes\//);
      assert.equal((await db.prepare('SELECT purpose FROM media WHERE key=?').bind(url.split('/media/')[1]).first()).purpose, 'shared-notes');
      assert.equal((await uploadImage('free', 'private.png', 'private-image')).status, 403);
      const image = { id: randomUUID(), url, name: 'shared.png', caption: 'An illustrated explanation' };
      const now = new Date().toISOString();
      const note = {
        id: noteKey, qbankId: 'smle-gs', questionId: 'gs-002', content: '', images: [image],
        version: (beforeNote ? JSON.parse(beforeNote.payload).version : 0) + 1,
        updatedById: 'free', updatedByName: 'free', updatedAt: now,
        history: beforeNote ? [...JSON.parse(beforeNote.payload).history, { id: randomUUID(), content: '', images: [image], editedById: 'free', editedByName: 'free', editedAt: now }] : [],
      };
      const saved = await call('free', '/collaboration', { operations: [{ collection: 'sharedNotes', id: noteKey, type: 'set', value: note }] }, 'PUT');
      assert.equal(saved.status, 200, JSON.stringify(saved));
      assert.deepEqual((await call('trial', '/collaboration')).data.collaboration.sharedNotes[noteKey].images, [image]);
      const caption = 'A revised description';
      const edited = { ...note, images: [{ ...image, caption }], version: note.version + 1, history: [...note.history, { id: randomUUID(), content: '', images: [{ ...image, caption }], editedById: 'free', editedByName: 'free', editedAt: now }] };
      assert.equal((await call('free', '/collaboration', { operations: [{ collection: 'sharedNotes', id: noteKey, type: 'set', value: edited }] }, 'PUT')).status, 200);
      assert.equal((await call('trial', '/collaboration')).data.collaboration.sharedNotes[noteKey].images[0].caption, caption);
      const read = await mf.dispatchFetch(`https://qraft.test${url}`, { headers: { cookie: '__Host-qraft_session=fixture-trial' } });
      assert.equal(read.status, 200);
      assert.match(read.headers.get('cache-control'), /private/);
      assert.equal((await mf.dispatchFetch(`https://qraft.test${url}`)).status, 401);

      const bank = { id: bankId, ownerId: 'monthly', name: 'Private image fixture', visibility: 'private', archived: false };
      await db.prepare("INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) VALUES('qbanks',?,?,?,?,?)").bind(bankId, bankId, 'monthly', JSON.stringify(bank), now).run();
      assert.equal((await uploadImage('free', 'forbidden.png', 'forbidden', 'shared-notes', bankId)).status, 403);
      assert.equal((await uploadImage('missing-session', 'unauthenticated.png', 'image', 'shared-notes')).status, 403);
      await db.prepare("UPDATE plan_prices SET policy_json=? WHERE plan='free'").bind(JSON.stringify({ ...(freePolicy.policy_json ? JSON.parse(freePolicy.policy_json) : {}), canUploadImages: false })).run();
      assert.equal((await uploadImage('free', 'disabled.png', 'disabled', 'shared-notes')).status, 403);
      await db.prepare("UPDATE plan_prices SET policy_json=? WHERE plan='free'").bind(freePolicy.policy_json).run();

      // A private-note file must not become the lifetime owner of a shared
      // explanation attachment: account deletion cleans private-note media.
      await db.prepare('DELETE FROM r2_usage_periods').run();
      const sharedCopy = await uploadImage('monthly', 'scan.png', 'png-test-content', 'shared-notes');
      assert.equal(sharedCopy.status, 201);
      const sharedCopyUrl = (await sharedCopy.json()).url;
      assert.match(sharedCopyUrl, /\/media\/shared-notes\//);
      const duplicate = await uploadImage('monthly', 'renamed.png', 'png-test-content', 'shared-notes');
      assert.equal(duplicate.status, 200);
      assert.equal((await duplicate.json()).url, sharedCopyUrl);
    } finally {
      const added = (await db.prepare('SELECT key,storage_key FROM media').all()).results.filter(row => !beforeKeys.has(row.key));
      const bucket = await mf.getR2Bucket('ASSETS');
      for (const row of added) {
        await bucket.delete(row.storage_key);
        await db.prepare('DELETE FROM media WHERE key=?').bind(row.key).run();
      }
      await db.prepare("UPDATE counters SET value=? WHERE id='r2-storage-bytes'").bind(storedBytes.value).run();
      await db.prepare('DELETE FROM r2_usage_periods').run();
      for (const row of usage.results)
        await db.prepare('INSERT INTO r2_usage_periods VALUES(?,?,?,?)').bind(row.period_start, row.class_a_operations, row.class_b_operations, row.updated_at).run();
      await db.prepare("UPDATE plan_prices SET policy_json=? WHERE plan='free'").bind(freePolicy.policy_json).run();
      if (beforeNote) await db.prepare("UPDATE records SET payload=?,updated_at=? WHERE type='sharedNotes' AND id=?").bind(beforeNote.payload, beforeNote.updated_at, noteKey).run();
      else await db.prepare("DELETE FROM records WHERE type='sharedNotes' AND id=?").bind(noteKey).run();
      await db.prepare("DELETE FROM records WHERE type='qbanks' AND id=?").bind(bankId).run();
    }
  });
}
