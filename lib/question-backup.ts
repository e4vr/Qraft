const HARD_RETENTION_DAYS = 14;
const HARD_SNAPSHOT_BYTES = 25 * 1024 * 1024;
const PAGE_SIZE = 250;
const PREFIX = 'question-backups/';

type QuestionBackupRow = {
  id: string;
  qbank_id: string | null;
  owner_id: string | null;
  payload: string;
  updated_at: string;
  question_id: string | null;
  uuid: string | null;
  registry_created_at: string | null;
};

function configuredLimit(value: string | undefined, fallback: number, hardMaximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, hardMaximum)
    : fallback;
}

async function gzip(value: Uint8Array) {
  const source = value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
  const compressed = new Blob([source])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Response(compressed).arrayBuffer();
}

async function checksum(value: Uint8Array) {
  const source = value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function createQuestionBackup(
  env: Cloudflare.Env,
  scheduledTime = Date.now(),
) {
  const maximumBytes = configuredLimit(
    env.QUESTION_BACKUP_MAX_BYTES,
    HARD_SNAPSHOT_BYTES,
    HARD_SNAPSHOT_BYTES,
  );
  const retentionDays = configuredLimit(
    env.QUESTION_BACKUP_RETENTION_DAYS,
    HARD_RETENTION_DAYS,
    HARD_RETENTION_DAYS,
  );
  const qbanks = await env.DB.prepare(
    "SELECT id,payload,updated_at FROM records WHERE type='qbanks' ORDER BY id",
  ).all<{ id: string; payload: string; updated_at: string }>();
  const questions: QuestionBackupRow[] = [];
  let cursor = '';
  let estimatedBytes = JSON.stringify(qbanks.results).length;
  while (true) {
    const page = await env.DB.prepare(
      `SELECT r.id,r.qbank_id,r.owner_id,r.payload,r.updated_at,
        q.question_id,q.uuid,q.created_at AS registry_created_at
       FROM records r INDEXED BY idx_records_type_id
       LEFT JOIN question_registry q ON q.id=r.id
       WHERE r.type='sharedQuestions' AND r.id>?
       ORDER BY r.id LIMIT ?`,
    )
      .bind(cursor, PAGE_SIZE)
      .all<QuestionBackupRow>();
    if (!page.results.length) break;
    for (const row of page.results) {
      estimatedBytes += row.payload.length + 512;
      if (estimatedBytes > maximumBytes)
        throw new Error('Question backup exceeded its 25 MB safety limit.');
      questions.push(row);
    }
    cursor = page.results.at(-1)!.id;
    if (page.results.length < PAGE_SIZE) break;
  }

  const createdAt = new Date(scheduledTime).toISOString();
  const snapshot = new TextEncoder().encode(
    JSON.stringify({
      format: 'qraft-question-backup-v1',
      createdAt,
      questionCount: questions.length,
      qbanks: qbanks.results,
      questions,
    }),
  );
  if (snapshot.byteLength > maximumBytes)
    throw new Error('Question backup exceeded its 25 MB safety limit.');
  const digest = await checksum(snapshot);
  const body = await gzip(snapshot);
  const key = `${PREFIX}${createdAt.slice(0, 10)}/${createdAt.replace(/[:.]/g, '-')}.json.gz`;
  await env.ASSETS.put(key, body, {
    httpMetadata: {
      contentType: 'application/gzip',
      cacheControl: 'private, no-store',
    },
    customMetadata: {
      format: 'qraft-question-backup-v1',
      createdAt,
      questionCount: String(questions.length),
      sha256: digest,
    },
  });

  const cutoff = scheduledTime - retentionDays * 86_400_000;
  const stored = await env.ASSETS.list({ prefix: PREFIX, limit: 1000 });
  const expired = stored.objects
    .filter((object) => object.uploaded.getTime() < cutoff)
    .map((object) => object.key);
  if (expired.length) await env.ASSETS.delete(expired);
  console.log(
    JSON.stringify({
      event: 'question_backup_completed',
      key,
      questionCount: questions.length,
      bytes: body.byteLength,
      expired: expired.length,
    }),
  );
}
