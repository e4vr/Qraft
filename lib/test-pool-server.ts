import { env } from 'cloudflare:workers';
import { canAccessBank } from '@/features/access/domain/access-policy';
import type {
  AppUser,
  Question,
  TestBuilderConfig,
} from './medguard-types';
import { bankAccessState } from './qbank-access-repository';
import { getPlanLimits } from '@/features/subscriptions/domain/plan-config';
import { json } from '@/server/http/response';

// Count and random selection share this exact predicate. The per-exam limit is
// applied only to the final SELECT, never to the candidates or count.
export async function testPool(user: AppUser, input: Record<string, unknown>) {
  const qbankId = typeof input.qbankId === 'string' ? input.qbankId : '';
  const state = await bankAccessState(qbankId);
  const bank = state.qbanks.find(item => item.id === qbankId);
  if (!bank || bank.archived || !canAccessBank(user, bank, state.memberships)) return json({ error: 'QBank access required.' }, 403);
  const config = input.config as TestBuilderConfig | undefined;
  const included = config?.includedTopics;
  const validIncluded = included === undefined || (
    Array.isArray(included) && included.every(item =>
      item && typeof item.specialty === 'string' && typeof item.topic === 'string' &&
      (item.specialtyId === undefined || (typeof item.specialtyId === 'string' && item.specialtyId.length > 0)) &&
      (item.topicId === undefined || (typeof item.topicId === 'string' && item.topicId.length > 0)),
    )
  );
  if (!config || typeof config.specialty !== 'string' || !Array.isArray(config.topics) || config.topics.some(topic => typeof topic !== 'string') || !validIncluded || !Array.isArray(config.statuses) || config.statuses.some(status => !['new','previous','correct','incorrect','flagged'].includes(status)))
    return json({ error: 'Invalid test filters.' }, 400);
  const includedTopics = JSON.stringify(included ?? []);
  const select = input.select === true;
  const limit = (user.planLimits ?? getPlanLimits(user.effectivePlan ?? user.tier)).maxQuestionsPerExam;
  if (select && (!Number.isInteger(config.count) || config.count < 1 || config.count > limit)) return json({ error: `Your plan allows at most ${limit} questions per test.` }, 403);
  const progress = input.progress && typeof input.progress === 'object' && !Array.isArray(input.progress) ? JSON.stringify(input.progress) : null;
  const sql = `WITH app AS (SELECT coalesce((SELECT payload FROM app_states WHERE user_id=?),'{}') AS payload),
    candidates AS (
      SELECT id,payload FROM records WHERE type='sharedQuestions' AND qbank_id=?
      UNION ALL
      SELECT json_extract(c.value,'$.id') AS id,c.value AS payload FROM app,json_each(app.payload,'$.customQuestions') c
      WHERE coalesce(json_extract(c.value,'$.qbankId'),'smle-gs')=?
        AND NOT EXISTS (SELECT 1 FROM records WHERE type='sharedQuestions' AND id=json_extract(c.value,'$.id'))
    ), effective_base AS (
      SELECT c.id,json_patch(c.payload,coalesce(o.value,'{}')) AS payload
      FROM candidates c CROSS JOIN app LEFT JOIN json_each(app.payload,'$.questionOverrides') o ON o.key=c.id
      WHERE NOT EXISTS (SELECT 1 FROM retired_questions WHERE id=c.id)
      GROUP BY c.id
    ), effective AS (
      SELECT e.id,t.id AS resolved_topic_id,s.id AS resolved_specialty_id,json_set(
        e.payload,
        '$.topic',coalesce(json_extract(t.payload,'$.name'),json_extract(e.payload,'$.topic')),
        '$.specialty',coalesce(json_extract(s.payload,'$.name'),json_extract(e.payload,'$.specialty'))
      ) AS payload
      FROM effective_base e
      LEFT JOIN records t ON t.type='qbankTopics' AND t.id=json_extract(e.payload,'$.topicId') AND t.qbank_id=?
      LEFT JOIN records s ON s.type='qbankSpecialties' AND s.id=coalesce(json_extract(t.payload,'$.specialtyId'),json_extract(e.payload,'$.specialtyId')) AND s.qbank_id=?
    ), eligible AS (
      SELECT q.id,q.payload FROM effective q CROSS JOIN app
      LEFT JOIN json_each(coalesce(?,json_extract(app.payload,'$.progress'),'{}')) p ON p.key=q.id
      WHERE ?=1 OR (
        (
          (json_array_length(?)=0 AND (?='' OR json_extract(q.payload,'$.specialty')=?)
            AND (json_array_length(?)=0 OR json_extract(q.payload,'$.topic') IN (SELECT value FROM json_each(?))))
          OR EXISTS (
            SELECT 1 FROM json_each(?) selected
            WHERE (
              (json_extract(selected.value,'$.specialtyId') IS NOT NULL AND q.resolved_specialty_id=json_extract(selected.value,'$.specialtyId'))
              OR ((json_extract(selected.value,'$.specialtyId') IS NULL OR q.resolved_specialty_id IS NULL) AND json_extract(selected.value,'$.specialty')=json_extract(q.payload,'$.specialty'))
            ) AND (
              (json_extract(selected.value,'$.topicId') IS NOT NULL AND q.resolved_topic_id=json_extract(selected.value,'$.topicId'))
              OR ((json_extract(selected.value,'$.topicId') IS NULL OR q.resolved_topic_id IS NULL) AND json_extract(selected.value,'$.topic')=json_extract(q.payload,'$.topic'))
            )
          )
        )
        AND (json_array_length(?)=0 OR EXISTS (
          SELECT 1 FROM json_each(?) s WHERE
            (s.value='new' AND coalesce(json_extract(p.value,'$.attempts'),0)=0) OR
            (s.value='previous' AND coalesce(json_extract(p.value,'$.attempts'),0)>0) OR
            (s.value='flagged' AND json_extract(p.value,'$.flagged')=1) OR
            (s.value='correct' AND json_extract(p.value,'$.attempts')>0 AND json_extract(p.value,'$.lastAnswer')=json_extract(q.payload,'$.answer')) OR
            (s.value='incorrect' AND json_extract(p.value,'$.attempts')>0 AND json_extract(p.value,'$.lastAnswer') IS NOT json_extract(q.payload,'$.answer'))
        ))
      )
    )`;
  const bindings = [user.uid, qbankId, qbankId, qbankId, qbankId, progress, config.randomAll ? 1 : 0, includedTopics, config.specialty, config.specialty, JSON.stringify(config.topics), JSON.stringify(config.topics), includedTopics, JSON.stringify(config.statuses), JSON.stringify(config.statuses)];
  if (!select) {
    const count = await env.DB.prepare(`${sql} SELECT count(*) AS eligible FROM eligible`).bind(...bindings).first<{ eligible: number }>();
    return json({ eligible: count?.eligible ?? 0 });
  }
  const rows = await env.DB.prepare(`${sql} SELECT payload FROM eligible ORDER BY random() LIMIT ?`).bind(...bindings, config.count).all<{ payload: string }>();
  if (rows.results.length < config.count) return json({ error: `Only ${rows.results.length} questions match these filters. Refresh the eligible count and try again.` }, 409);
  return json({ questions: rows.results.map(row => JSON.parse(row.payload) as Question) });
}
