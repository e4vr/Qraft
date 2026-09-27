import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

void test('telemetry writes only pseudonymous counters, honors capacity under concurrency and fails safely', async () => {
  await mkdir('.ui-review', { recursive: true });
  const points = [];
  let identityWrites = 0,
    reservations = 0,
    allowReservation = true;
  const telemetryEnv = {
    QRAFT_TELEMETRY_ENABLED: 'true',
    TELEMETRY_SALT: 'local-telemetry-salt-for-tests-only',
    REALTIME: {
      getByName: () => ({
        reserveUsageBudget: async (count) => {
          assert.equal(count, 256);
          reservations++;
          return allowReservation;
        },
      }),
    },
    DB: {
      prepare: (sql) => {
        assert.match(sql, /monitoring_identities/);
        return {
          bind: (hash, userId) => ({
            run: async () => {
              assert.equal(userId, 'learner-private-1');
              assert.match(hash, /^[a-f0-9]{64}$/);
              identityWrites++;
            },
          }),
        };
      },
    },
    QRAFT_USAGE: {
      writeDataPoint: (point) => {
        points.push(point);
      },
    },
  };
  globalThis.__qraftTelemetryTestEnv = telemetryEnv;
  try {
    await build({
      entryPoints: ['features/administration/server/usage-telemetry.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: '.ui-review/usage-telemetry-test.mjs',
      plugins: [
        {
          name: 'test-only-worker-env',
          setup(builder) {
            builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
              path: 'env',
              namespace: 'fixture',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents:
                'export const env = globalThis.__qraftTelemetryTestEnv;',
              loader: 'js',
            }));
          },
        },
      ],
    });
    const { emitUsage } =
      await import('../.ui-review/usage-telemetry-test.mjs');
    await emitUsage('learner-private-1', {
      testsCompleted: 1,
      questionsAnswered: 3,
      questionText: 'private question text',
      email: 'private@example.test',
    });
    assert.deepEqual(points[0], {
      indexes: [
        createHmac('sha256', telemetryEnv.TELEMETRY_SALT)
          .update('learner-private-1')
          .digest('hex'),
      ],
      blobs: ['v1'],
      doubles: [0, 1, 3, 0, 0, 0, 0],
    });
    allowReservation = false;
    await Promise.all(
      Array.from({ length: 800 }, () =>
        emitUsage('learner-private-1', { questionsAnswered: 1 }),
      ),
    );
    assert.equal(points.length, 256);
    assert.equal(identityWrites, 1);
    assert.equal(reservations, 2);
    assert.doesNotMatch(
      JSON.stringify(points),
      /learner-private-1|private@example|private question/,
    );
    telemetryEnv.QRAFT_TELEMETRY_ENABLED = 'false';
    await emitUsage('learner-private-1', { questionsAnswered: 3 });
    assert.equal(points.length, 256);
    assert.equal(reservations, 2);
    telemetryEnv.QRAFT_TELEMETRY_ENABLED = 'true';
    allowReservation = true;
    telemetryEnv.QRAFT_USAGE.writeDataPoint = () => {
      throw new Error('Provider offline');
    };
    await assert.doesNotReject(
      emitUsage('learner-private-1', { testsCompleted: 1 }),
    );
  } finally {
    delete globalThis.__qraftTelemetryTestEnv;
  }
});
