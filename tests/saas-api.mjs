import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// Runs against the real bundled API and a disposable local D1 database. This is
// correctness/load evidence for workerd, not a Cloudflare production capacity SLA.
export async function saasApiTests(t, { db, call, mf, emptyState }) {
  await t.test(
    'API rejects malformed inputs and cross-account outbox replay without changing stored data',
    async () => {
      for (const state of [
        { version: 1 },
        { ...emptyState(), progress: { broken: null } },
      ])
        assert.equal(
          (await call('monthly', '/state', { state }, 'PUT')).status,
          400,
        );
      assert.equal(
        (await call('monthly', '/auth/login', { email: 42, password: [] })).status,
        400,
      );
      const response = await mf.dispatchFetch(
        'https://qraft.test/api/cloudflare/state',
        {
          method: 'PUT',
          headers: {
            cookie: '__Host-qraft_session=fixture-monthly',
            origin: 'https://qraft.test',
            'x-qraft-account': 'other',
          },
          body: JSON.stringify({ state: emptyState() }),
        },
      );
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'ACCOUNT_CHANGED');
      assert.ok(response.headers.get('x-request-id'));
      const invalid = await mf.dispatchFetch(
        'https://qraft.test/api/cloudflare/auth/login',
        { method: 'POST', body: 'null' },
      );
      assert.equal(invalid.status, 400);
      assert.equal(invalid.headers.get('cache-control'), 'no-store');
      assert.equal(typeof (await invalid.json()).error, 'string');
    },
  );

  await t.test(
    'database failures are server errors with a support ID and no SQL disclosure',
    async () => {
      await db
        .prepare(
          'ALTER TABLE discount_codes RENAME TO saas_fault_discount_codes',
        )
        .run();
      try {
        const result = await call('monthly', '/platform/quote', {
          plan: 'full_monthly',
          code: 'FAILURE',
        });
        assert.equal(result.status, 500);
        assert.equal(typeof result.data.requestId, 'string');
        assert.doesNotMatch(
          JSON.stringify(result.data),
          /discount_codes|SELECT|D1_ERROR|no such table/i,
        );
      } finally {
        await db
          .prepare(
            'ALTER TABLE saas_fault_discount_codes RENAME TO discount_codes',
          )
          .run();
      }
    },
  );

  await t.test(
    '100 concurrent accounts preserve answers, private state and idempotent writes',
    async () => {
      const users = Array.from({ length: 100 }, (_, i) => `saas-${i}`);
      const now = new Date().toISOString();
      const questionRow = await db
        .prepare(
          "SELECT id,payload FROM records WHERE type='sharedQuestions' AND qbank_id='smle-gs' LIMIT 1",
        )
        .first();
      assert.ok(questionRow);
      const statId = `smle-gs:${questionRow.id}`;
      const savedStats = await db
        .prepare("SELECT * FROM records WHERE type='answerStats' AND id=?")
        .bind(statId)
        .first();
      await db.batch(
        users.flatMap((uid) => [
          db
            .prepare(
              'INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
            )
            .bind(
              uid,
              `${uid}@example.test`,
              'unused',
              'unused',
              JSON.stringify({
                uid,
                email: `${uid}@example.test`,
                displayName: uid,
                tier: 'full_monthly',
                role: 'student',
                status: 'approved',
                platformRoles: [],
                createdAt: now,
              }),
              now,
              now,
            ),
          db
            .prepare(
              'INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)',
            )
            .bind(
              createHash('sha256').update(`fixture-${uid}`).digest('hex'),
              uid,
              Math.floor(Date.now() / 1000) + 3600,
              now,
            ),
        ]),
      );
      const measurements = [];
      const sockets = [];
      const firstMessages = [];
      async function measured(uid, path, body, method) {
        const started = performance.now();
        const result = await call(uid, path, body, method);
        measurements.push({
          path,
          status: result.status,
          ms: performance.now() - started,
        });
        assert.equal(
          result.status,
          200,
          `${path}: ${JSON.stringify(result.data)}`,
        );
        return result.data;
      }
      const started = performance.now();
      try {
        await Promise.all(
          users.map(async (uid) => {
            const response = await mf.dispatchFetch(
              'https://qraft.test/api/cloudflare/realtime?channel=bank%3Asmle-gs',
              {
                headers: {
                  cookie: `__Host-qraft_session=fixture-${uid}`,
                  origin: 'https://qraft.test',
                  upgrade: 'websocket',
                },
              },
            );
            assert.equal(response.status, 101);
            const socket = response.webSocket;
            assert.ok(socket);
            socket.accept();
            sockets.push(socket);
            firstMessages.push(
              new Promise((resolve) =>
                socket.addEventListener(
                  'message',
                  (event) => resolve(JSON.parse(String(event.data))),
                  { once: true },
                ),
              ),
            );
          }),
        );
        await Promise.all(
          users.map(async (uid, index) => {
            const state = emptyState({
              clientUpdatedAt: now,
              progress: {
                [questionRow.id]: {
                  note: `Private note ${uid}`,
                  updatedAt: now,
                },
              },
            });
            const operationId = randomUUID();
            const body = { state, baseRevision: 0, operationId };
            await measured(uid, '/auth/session');
            const first = await measured(uid, '/state', body, 'PUT');
            assert.equal(first.revision, 1);
            const replay = await measured(uid, '/state', body, 'PUT');
            assert.equal(replay.duplicate, true);
            assert.equal(replay.revision, 1);
            await measured(
              uid,
              '/collaboration',
              {
                operations: [
                  {
                    type: 'set',
                    collection: 'answerStats',
                    id: statId,
                    value: {
                      id: statId,
                      qbankId: 'smle-gs',
                      questionId: questionRow.id,
                      selections: { [uid]: index % 2 },
                    },
                  },
                ],
              },
              'PUT',
            );
            const loaded = await measured(uid, '/state');
            assert.equal(
              loaded.state.progress[questionRow.id].note,
              `Private note ${uid}`,
            );
          }),
        );
        const stats = JSON.parse(
          (
            await db
              .prepare(
                "SELECT payload FROM records WHERE type='answerStats' AND id=?",
              )
              .bind(statId)
              .first()
          ).payload,
        );
        users.forEach((uid, index) =>
          assert.equal(
            stats.selections[uid],
            index % 2,
            `Lost concurrent answer for ${uid}`,
          ),
        );
        let notificationTimeout;
        try {
          const messages = await Promise.race([
            Promise.all(firstMessages),
            new Promise((_, reject) => {
              notificationTimeout = setTimeout(
                () => reject(new Error('Realtime notification missing')),
                5000,
              );
            }),
          ]);
          assert.equal(messages.length, 100);
          for (const message of messages) {
            assert.equal(message.type, 'resources_changed');
            assert.ok(message.resources.includes('question-stats'));
            assert.deepEqual(Object.keys(message).sort(), [
              'resources',
              'type',
            ]);
          }
        } finally {
          clearTimeout(notificationTimeout);
        }
        // Two writes from the same revision must produce one winner, not silent loss.
        const conflict = await Promise.all(
          [25, 30].map((dailyGoal) =>
            call(
              users[0],
              '/state/daily-goal',
              {
                dailyGoal,
                baseRevision: 1,
                operationId: randomUUID(),
              },
              'PUT',
            ),
          ),
        );
        assert.deepEqual(
          conflict.map((item) => item.status).sort((a, b) => a - b),
          [200, 409],
        );
        const durations = measurements
          .map((item) => item.ms)
          .sort((a, b) => a - b);
        const percentile = (p) =>
          Math.round(durations[Math.ceil(durations.length * p) - 1]);
        const report = {
          environment:
            'local workerd + disposable D1; not production capacity certification',
          at: new Date().toISOString(),
          concurrentUsers: users.length,
          measuredRequests: measurements.length,
          failures: measurements.filter((item) => item.status !== 200).length,
          elapsedMs: Math.round(performance.now() - started),
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          p99Ms: percentile(0.99),
          preservedAnswers: users.length,
          checks: [
            'private-state isolation',
            'idempotent replay',
            'shared-answer concurrency',
            'same-revision conflict',
          ],
        };
        report.realtimeConnections = sockets.length;
        report.realtimeRecipientsVerified = firstMessages.length;
        await mkdir('outputs', { recursive: true });
        await writeFile(
          'outputs/saas-local-load.json',
          JSON.stringify(report, null, 2) + '\n',
        );
        t.diagnostic(JSON.stringify(report));
      } finally {
        for (const socket of sockets)
          socket.close(1000, 'Local validation complete');
        await db.batch([
          db
            .prepare("DELETE FROM records WHERE type='answerStats' AND id=?")
            .bind(statId),
          db
            .prepare(
              "DELETE FROM records WHERE type='auditLog' AND owner_id IN (SELECT value FROM json_each(?))",
            )
            .bind(JSON.stringify(users)),
          db
            .prepare(
              'DELETE FROM profiles WHERE uid IN (SELECT value FROM json_each(?))',
            )
            .bind(JSON.stringify(users)),
        ]);
        if (savedStats)
          await db
            .prepare(
              'INSERT INTO records(type,id,qbank_id,owner_id,email,payload,updated_at) VALUES(?,?,?,?,?,?,?)',
            )
            .bind(
              savedStats.type,
              savedStats.id,
              savedStats.qbank_id,
              savedStats.owner_id,
              savedStats.email,
              savedStats.payload,
              savedStats.updated_at,
            )
            .run();
      }
    },
  );
}
