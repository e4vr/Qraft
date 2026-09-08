import { env } from 'cloudflare:workers';

export interface StoredAsset {
  key: string;
  provider: 'r2';
  size: number;
  contentType: string;
}

export interface StorageService {
  upload(key: string, body: ReadableStream | ArrayBuffer, metadata: { contentType: string; cacheControl: string; ownerId: string; qbankId: string; size: number }): Promise<StoredAsset>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string, size?: number): Promise<void>;
}

export class R2QuotaExceededError extends Error {
  constructor(public readonly quota: 'class-a' | 'class-b') {
    super(
      quota === 'class-a'
        ? 'The monthly upload limit has been reached. Uploads will resume in the next billing period.'
        : 'The monthly asset-view limit has been reached. Access will resume in the next billing period.',
    );
    this.name = 'R2QuotaExceededError';
  }
}

const HARD_CLASS_A_CAP = 800_000;
const HARD_CLASS_B_CAP = 8_000_000;
const HARD_STORAGE_CAP_BYTES = 3 * 1024 * 1024 * 1024;

function configuredCap(value: string | undefined, hardMaximum: number) {
  const configured = Number(value);
  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, hardMaximum)
    : hardMaximum;
}

function billingPeriodStart(now = new Date()): string {
  const configuredDay = Number(env.R2_BILLING_CYCLE_DAY);
  const cycleDay =
    Number.isInteger(configuredDay) && configuredDay >= 1 && configuredDay <= 28
      ? configuredDay
      : 1;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start =
    now.getUTCDate() >= cycleDay
      ? new Date(Date.UTC(year, month, cycleDay))
      : new Date(Date.UTC(year, month - 1, cycleDay));
  return start.toISOString().slice(0, 10);
}

async function reserveOperation(operation: 'class-a' | 'class-b') {
  const classA = operation === 'class-a' ? 1 : 0;
  const classB = operation === 'class-b' ? 1 : 0;
  const classACap = configuredCap(
    env.R2_CLASS_A_MONTHLY_CAP,
    HARD_CLASS_A_CAP,
  );
  const classBCap = configuredCap(
    env.R2_CLASS_B_MONTHLY_CAP,
    HARD_CLASS_B_CAP,
  );
  const now = new Date().toISOString();
  const reserved = await env.DB.prepare(
    `INSERT INTO r2_usage_periods(period_start,class_a_operations,class_b_operations,updated_at)
      VALUES(?,?,?,?)
      ON CONFLICT(period_start) DO UPDATE SET
        class_a_operations=r2_usage_periods.class_a_operations+excluded.class_a_operations,
        class_b_operations=r2_usage_periods.class_b_operations+excluded.class_b_operations,
        updated_at=excluded.updated_at
      WHERE r2_usage_periods.class_a_operations+excluded.class_a_operations<=?
        AND r2_usage_periods.class_b_operations+excluded.class_b_operations<=?
      RETURNING period_start`,
  )
    .bind(billingPeriodStart(), classA, classB, now, classACap, classBCap)
    .first<{ period_start: string }>();
  if (!reserved) throw new R2QuotaExceededError(operation);
}

async function reserveStorage(bytes: number) {
  const cap = configuredCap(env.R2_STORAGE_CAP_BYTES, HARD_STORAGE_CAP_BYTES);
  const reserved = await env.DB.prepare(
    `INSERT INTO counters(id,value,updated_at) VALUES('r2-storage-bytes',?,?)
      ON CONFLICT(id) DO UPDATE SET
        value=counters.value+excluded.value,
        updated_at=excluded.updated_at
      WHERE counters.value+excluded.value<=?
      RETURNING value`,
  )
    .bind(bytes, new Date().toISOString(), cap)
    .first<{ value: number }>();
  if (!reserved)
    throw new Error(
      'The 3 GB image storage safety limit has been reached. Delete unused images before uploading more.',
    );
}

async function releaseStorage(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  await env.DB.prepare(
    "UPDATE counters SET value=max(0,value-?),updated_at=? WHERE id='r2-storage-bytes'",
  )
    .bind(bytes, new Date().toISOString())
    .run();
}

function bucket(): R2Bucket {
  const assets = env.ASSETS;
  if (!assets) throw new Error('R2 storage is not configured on this deployment.');
  return assets;
}

export const r2StorageService: StorageService = {
  async upload(key, body, metadata) {
    await reserveStorage(metadata.size);
    try {
      await reserveOperation('class-a');
    } catch (error) {
      await releaseStorage(metadata.size);
      throw error;
    }
    let object: R2Object;
    try {
      object = await bucket().put(key, body, {
        httpMetadata: {
          contentType: metadata.contentType,
          cacheControl: metadata.cacheControl,
        },
        customMetadata: {
          ownerId: metadata.ownerId,
          qbankId: metadata.qbankId,
        },
      });
    } catch (error) {
      await releaseStorage(metadata.size);
      throw error;
    }
    return {
      key: object.key,
      provider: 'r2',
      size: object.size,
      contentType: metadata.contentType,
    };
  },
  async get(key) {
    await reserveOperation('class-b');
    return bucket().get(key);
  },
  async delete(key, size = 0) {
    await bucket().delete(key);
    await releaseStorage(size);
  },
};

export function hasR2Storage(): boolean {
  return Boolean(env.ASSETS);
}
