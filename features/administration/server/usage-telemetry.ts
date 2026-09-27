import { env } from 'cloudflare:workers';
import type { UsageCounts } from '../domain/monitoring';
import { USAGE_KEYS } from '../domain/monitoring';

type BudgetStub = DurableObjectStub & {
  reserveUsageBudget(count: number): Promise<boolean>;
};
// Capacity reservations are durable; isolate-local leases only spend already reserved capacity.
// Lost leases reduce coverage and can never exceed the global daily/monthly ceiling.
let lease = { day: '', remaining: 0 };
let reserving: Promise<boolean> | undefined;
const identities = new Map<string, Promise<string>>();
export async function emitUsage(
  userId: string,
  usage: Partial<UsageCounts> = {},
) {
  if (
    env.QRAFT_TELEMETRY_ENABLED !== 'true' ||
    !env.QRAFT_USAGE ||
    (env.TELEMETRY_SALT?.length ?? 0) < 32 ||
    !env.REALTIME
  )
    return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (lease.day !== day) lease = { day, remaining: 0 };
    if (lease.remaining <= 0) {
      if (!reserving)
        reserving = (env.REALTIME.getByName('monitoring-budget') as BudgetStub)
          .reserveUsageBudget(256)
          .then((allowed) => {
            if (allowed && lease.day === day) lease.remaining += 256;
            return allowed;
          })
          .finally(() => {
            reserving = undefined;
          });
      if (!(await reserving) || lease.remaining <= 0) return;
    }
    lease.remaining -= 1;
    let identity = identities.get(userId);
    if (!identity) {
      identity = (async () => {
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(env.TELEMETRY_SALT!),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const hash = await crypto.subtle.sign(
          'HMAC',
          key,
          new TextEncoder().encode(userId),
        );
        const id = [...new Uint8Array(hash)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        await env.DB.prepare(
          'INSERT INTO monitoring_identities(telemetry_id,user_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET telemetry_id=excluded.telemetry_id',
        )
          .bind(id, userId)
          .run();
        return id;
      })();
      if (identities.size >= 2_000) identities.clear();
      identities.set(userId, identity);
    }
    const id = await identity;
    env.QRAFT_USAGE.writeDataPoint({
      indexes: [id],
      blobs: ['v1'],
      doubles: USAGE_KEYS.map((key) =>
        Math.min(100_000, Math.max(0, Math.trunc(usage[key] ?? 0))),
      ),
    });
  } catch {
    identities.delete(userId);
    // Observability must never change the outcome of a committed user operation.
    console.warn(JSON.stringify({ event: 'usage_telemetry_unavailable' }));
  }
}
