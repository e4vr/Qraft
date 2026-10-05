import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function announcementApiTests(t, { db, call, mf, uploadImage }) {
  const beforeSettings = await db
    .prepare(
      "SELECT * FROM records WHERE type='system' AND id IN ('announcement','communityLinks')",
    )
    .all();
  const beforeDismissals = await db
    .prepare("SELECT * FROM records WHERE type='announcementDismissals'")
    .all();
  const publicRead = async () => {
    const response = await mf.dispatchFetch(
      'https://qraft.test/api/cloudflare/platform/announcement',
    );
    return { status: response.status, data: await response.json() };
  };
  const draft = {
    enabled: false,
    title: 'News',
    content: 'New study tools',
    href: '',
    images: [],
    displayMode: 'once',
  };
  try {
    await db
      .prepare(
        "DELETE FROM records WHERE type='system' AND id IN ('announcement','communityLinks') OR type='announcementDismissals'",
      )
      .run();
    await t.test(
      'only verified Superadmins manage announcements; drafts stay private and invalid content is rejected',
      async () => {
        assert.equal((await publicRead()).status, 200);
        assert.equal((await publicRead()).data.enabled, false);
        for (const uid of ['free', 'reviewer', 'root-unverified']) {
          assert.equal(
            (await call(uid, '/platform/announcement?manage=1')).status,
            403,
          );
          assert.equal(
            (await call(uid, '/platform/announcement', draft, 'PUT')).status,
            403,
          );
        }
        const saved = await call(
          'admin',
          '/platform/announcement',
          draft,
          'PUT',
        );
        assert.equal(saved.status, 200);
        assert.equal(
          (await call('admin', '/platform/announcement?manage=1')).data.content,
          draft.content,
        );
        assert.equal((await publicRead()).data.content, '');
        for (const invalid of [
          { enabled: true, content: '' },
          { href: 'javascript:alert(1)' },
          { title: 'x'.repeat(121) },
          { content: 'x'.repeat(5001) },
          {
            images: [
              {
                id: 'x',
                url: '/api/cloudflare/media/notes/private.png',
                name: 'private.png',
                caption: '',
              },
            ],
          },
          {
            images: [
              {
                id: 'x',
                url: '/api/cloudflare/media/announcements/%broken',
                name: 'bad.png',
                caption: '',
              },
            ],
          },
          {
            images: Array.from({ length: 6 }, (_, i) => ({
              id: String(i),
              url: 'https://example.test/photo.png',
              name: 'photo.png',
              caption: '',
            })),
          },
        ])
          assert.equal(
            (
              await call(
                'admin',
                '/platform/announcement',
                { ...draft, ...invalid },
                'PUT',
              )
            ).status,
            400,
          );
        assert.equal(
          (await call('admin', '/platform/announcement', draft, 'PUT')).data
            .revision,
          saved.data.revision,
        );
      },
    );

    await t.test(
      'announcements require sign-in and each account sees each activation once across sessions',
      async () => {
        const published = await call(
          'admin',
          '/platform/announcement',
          { ...draft, enabled: true },
          'PUT',
        );
        assert.equal(published.status, 200);
        const revision = published.data.revision;
        assert.ok(revision);
        assert.equal((await publicRead()).data.enabled, false);
        assert.equal((await publicRead()).data.content, '');
        assert.deepEqual((await publicRead()).data.images, []);
        assert.equal((await call('root-unverified', '/platform/announcement')).data.enabled, false);
        assert.equal((await call('free', '/platform/announcement')).data.content, draft.content);
        assert.equal(
          (await call('free', '/platform/announcement')).data.dismissed,
          false,
        );
        assert.equal(
          (await call('free', '/platform/announcement-dismiss', { revision }))
            .status,
          200,
        );
        assert.equal(
          (await call('free', '/platform/announcement')).data.dismissed,
          true,
        );
        assert.equal(
          (await call('monthly', '/platform/announcement')).data.dismissed,
          false,
        );
        assert.equal(
          (await call('free', '/platform/announcement-dismiss', { revision }))
            .status,
          200,
        );
        const count = await db
          .prepare(
            "SELECT COUNT(*) AS count FROM records WHERE type='announcementDismissals' AND id='free' AND owner_id='free'",
          )
          .first();
        assert.equal(count.count, 1);
        assert.equal(
          (
            await call('monthly', '/platform/announcement-dismiss', {
              revision: 'stale',
            })
          ).status,
          409,
        );
        const changed = await call(
          'admin',
          '/platform/announcement',
          { ...draft, enabled: true, content: 'A new announcement' },
          'PUT',
        );
        assert.equal(changed.data.revision, revision, 'editing content is not a new activation');
        assert.equal(
          (await call('free', '/platform/announcement')).data.dismissed,
          true,
        );
        assert.equal(
          (await call('free', '/platform/announcement-dismiss', { revision }))
            .status,
          200,
        );
        const disabled = await call(
          'admin',
          '/platform/announcement',
          { ...changed.data, enabled: false },
          'PUT',
        );
        assert.equal(disabled.status, 200);
        assert.equal((await publicRead()).data.content, '');
        assert.equal(
          (await call('admin', '/platform/announcement?manage=1')).data.content,
          'A new announcement',
        );
        const reactivated = await call(
          'admin', '/platform/announcement', { ...disabled.data, enabled: true, displayMode: 'visit' }, 'PUT',
        );
        assert.equal(reactivated.status, 200);
        assert.notEqual(reactivated.data.revision, revision);
        assert.equal(reactivated.data.displayMode, 'once', 'legacy visit mode must normalize to once');
        const nextRevision = reactivated.data.revision;
        for (const uid of ['free', 'monthly']) {
          assert.equal((await call(uid, '/platform/announcement')).data.dismissed, false);
          assert.equal((await call(uid, '/platform/announcement-dismiss', { revision: nextRevision })).status, 200);
          assert.equal((await call(uid, '/platform/announcement')).data.dismissed, true);
        }
        assert.equal((await call('free', '/platform/announcement-dismiss', { revision })).status, 409);
        const unchanged = await call('admin', '/platform/announcement', reactivated.data, 'PUT');
        assert.equal(unchanged.data.revision, nextRevision);
        assert.equal(unchanged.data.unchanged, true);
        assert.equal((await call('free', '/platform/announcement')).data.dismissed, true);
      },
    );

    await t.test(
      'Telegram defaults to Qraft, supports Superadmin changes and rejects unsafe or unrelated URLs',
      async () => {
        assert.equal(
          (await call('free', '/platform/community-links')).data.telegramUrl,
          'https://t.me/QraftQBanks',
        );
        for (const uid of ['free', 'reviewer', 'root-unverified'])
          assert.equal(
            (
              await call(
                uid,
                '/platform/community-links',
                { telegramUrl: 'https://t.me/UpdatedQraft' },
                'PUT',
              )
            ).status,
            403,
          );
        for (const telegramUrl of [
          'javascript:alert(1)',
          'http://t.me/QraftQBanks',
          'https://example.test/Qraft',
          'https://t.me.evil.test/Qraft',
          'https://admin@t.me/Qraft',
          'https://t.me/Qraft?redirect=https://evil.test',
        ])
          assert.equal(
            (
              await call(
                'admin',
                '/platform/community-links',
                { telegramUrl },
                'PUT',
              )
            ).status,
            400,
          );
        const telegramUrl = 'https://t.me/UpdatedQraft';
        assert.equal(
          (
            await call(
              'admin',
              '/platform/community-links',
              { telegramUrl },
              'PUT',
            )
          ).status,
          200,
        );
        assert.equal(
          (await call('free', '/platform/community-links')).data.telegramUrl,
          telegramUrl,
        );
        assert.equal(
          (
            await call(
              'admin',
              '/platform/community-links',
              { telegramUrl: '' },
              'PUT',
            )
          ).status,
          200,
        );
        assert.equal(
          (await call('free', '/platform/community-links')).data.telegramUrl,
          '',
        );
      },
    );

    await t.test(
      'announcement uploads require verified Superadmin; only currently published images are public',
      async () => {
        const usage = await db.prepare('SELECT * FROM r2_usage_periods').all();
        const storedBytes = await db
          .prepare("SELECT value FROM counters WHERE id='r2-storage-bytes'")
          .first();
        const beforeKeys = new Set(
          (await db.prepare('SELECT key FROM media').all()).results.map(
            (row) => row.key,
          ),
        );
        const fetchImage = async (url, uid) => {
          await db.prepare('DELETE FROM r2_usage_periods').run();
          return mf.dispatchFetch(
            `https://qraft.test${url}`,
            uid
              ? { headers: { cookie: `__Host-qraft_session=fixture-${uid}` } }
              : {},
          );
        };
        try {
          for (const uid of ['free', 'reviewer', 'root-unverified'])
            assert.equal(
              (
                await uploadImage(
                  uid,
                  'news.png',
                  'news-photo',
                  'announcements',
                )
              ).status,
              403,
            );
          await db.prepare('DELETE FROM r2_usage_periods').run();
          const uploaded = await uploadImage(
            'admin',
            'news.png',
            'news-photo',
            'announcements',
          );
          assert.equal(uploaded.status, 201, await uploaded.clone().text());
          const { url } = await uploaded.json();
          assert.match(url, /\/media\/announcements\//);
          assert.equal((await fetchImage(url)).status, 404);
          assert.equal((await fetchImage(url, 'free')).status, 404);
          assert.equal((await fetchImage(url, 'root-unverified')).status, 404);
          assert.equal((await fetchImage(url, 'admin')).status, 200);
          const image = {
            id: randomUUID(),
            url,
            name: 'news.png',
            caption: 'News illustration',
          };
          const published = await call(
            'admin',
            '/platform/announcement',
            { ...draft, enabled: true, content: '', images: [image] },
            'PUT',
          );
          assert.equal(published.status, 200);
          assert.deepEqual((await publicRead()).data.images, []);
          assert.deepEqual((await call('free', '/platform/announcement')).data.images, [image]);
          const publicImage = await fetchImage(url);
          assert.equal(publicImage.status, 200);
          assert.match(publicImage.headers.get('cache-control'), /no-store/);
          assert.equal(
            (
              await call(
                'admin',
                '/platform/announcement',
                { ...published.data, enabled: false },
                'PUT',
              )
            ).status,
            200,
          );
          assert.equal((await fetchImage(url)).status, 404);
          assert.equal((await fetchImage(url, 'admin')).status, 200);
        } finally {
          const bucket = await mf.getR2Bucket('ASSETS');
          for (const row of (
            await db.prepare('SELECT key,storage_key FROM media').all()
          ).results.filter((row) => !beforeKeys.has(row.key))) {
            await bucket.delete(row.storage_key);
            await db
              .prepare('DELETE FROM media WHERE key=?')
              .bind(row.key)
              .run();
          }
          await db
            .prepare("UPDATE counters SET value=? WHERE id='r2-storage-bytes'")
            .bind(storedBytes.value)
            .run();
          await db.prepare('DELETE FROM r2_usage_periods').run();
          for (const row of usage.results)
            await db
              .prepare('INSERT INTO r2_usage_periods VALUES(?,?,?,?)')
              .bind(
                row.period_start,
                row.class_a_operations,
                row.class_b_operations,
                row.updated_at,
              )
              .run();
        }
      },
    );
  } finally {
    await db
      .prepare(
        "DELETE FROM records WHERE type='system' AND id IN ('announcement','communityLinks') OR type='announcementDismissals'",
      )
      .run();
    for (const row of [...beforeSettings.results, ...beforeDismissals.results])
      await db
        .prepare(
          'INSERT INTO records(type,id,owner_id,payload,updated_at) VALUES(?,?,?,?,?)',
        )
        .bind(row.type, row.id, row.owner_id, row.payload, row.updated_at)
        .run();
  }
}
