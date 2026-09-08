import { env } from 'cloudflare:workers';

export async function allocateQuestionIds(
  count: number,
  qbankId: string,
  userId: string,
) {
  const now = new Date().toISOString();
  const reused = await env.DB.prepare(
    `DELETE FROM question_id_free_pool
      WHERE numeric_id IN (
        SELECT numeric_id FROM question_id_free_pool ORDER BY numeric_id LIMIT ?
      )
      RETURNING numeric_id`,
  )
    .bind(count)
    .all<{ numeric_id: number }>();
  const numericIds = reused.results.map((item) => item.numeric_id);
  const remaining = count - numericIds.length;
  if (remaining > 0) {
    const range = await env.DB.prepare(
      `UPDATE question_id_allocator
        SET next_value=next_value+?, updated_at=?
        WHERE scope='global' AND next_value+?-1<=99999
        RETURNING next_value-? AS start_value`,
    )
      .bind(remaining, now, remaining, remaining)
      .first<{ start_value: number }>();
    if (!range) {
      if (numericIds.length)
        await env.DB.prepare(
          'INSERT OR IGNORE INTO question_id_free_pool(numeric_id) SELECT value FROM json_each(?)',
        )
          .bind(JSON.stringify(numericIds))
          .run();
      return [];
    }
    for (let value = range.start_value; value < range.start_value + remaining; value++)
      numericIds.push(value);
  }
  numericIds.sort((left, right) => left - right);
  try {
    const allocated = await env.DB.prepare(
      `INSERT INTO question_ids(question_id,qbank_id,created_by_id,created_at)
      SELECT printf('%05d',value),?,?,? FROM json_each(?)
      RETURNING question_id`,
    )
      .bind(qbankId, userId, now, JSON.stringify(numericIds))
      .all<{ question_id: string }>();
    return allocated.results.map((item) => item.question_id);
  } catch (error) {
    // Keep the finite 00001-99999 namespace reusable if the final write fails.
    await env.DB.prepare(
      'INSERT OR IGNORE INTO question_id_free_pool(numeric_id) SELECT value FROM json_each(?)',
    )
      .bind(JSON.stringify(numericIds))
      .run();
    throw error;
  }
}
