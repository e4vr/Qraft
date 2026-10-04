// Append these statements to the content writer's atomic D1 batch. Drafts and
// proposals are not bank questions; publication restores their classification
// IDs from the question itself before removing unused classifications.
function normalizedNameSql(value: string) {
  let expression = value;
  for (const code of [9, 10, 13, 160]) expression = `replace(${expression},char(${code}),' ')`;
  for (let pass = 0; pass < 8; pass++) expression = `replace(${expression},'  ',' ')`;
  return `lower(trim(${expression}))`;
}

const occupiedClassification = `WITH questions AS (
  SELECT id, qbank_id,
    json_extract(payload,'$.topicId') topic_id,
    json_extract(payload,'$.specialtyId') specialty_id,
    json_extract(payload,'$.topic') topic_name,
    json_extract(payload,'$.specialty') specialty_name
  FROM records WHERE type='sharedQuestions' AND qbank_id=?
), occupied AS (
  SELECT coalesce(assigned_topic.id,named_topic.id) topic_id,
    coalesce(assigned_specialty.id,named_specialty.id) specialty_id
  FROM questions q
  LEFT JOIN records assigned_topic ON assigned_topic.type='qbankTopics'
    AND assigned_topic.qbank_id=q.qbank_id AND assigned_topic.id=q.topic_id
  LEFT JOIN records assigned_specialty ON assigned_specialty.type='qbankSpecialties'
    AND assigned_specialty.qbank_id=q.qbank_id
    AND assigned_specialty.id=coalesce(json_extract(assigned_topic.payload,'$.specialtyId'),q.specialty_id)
  LEFT JOIN records named_specialty ON assigned_specialty.id IS NULL
    AND named_specialty.type='qbankSpecialties' AND named_specialty.qbank_id=q.qbank_id
    AND ${normalizedNameSql("json_extract(named_specialty.payload,'$.name')")}=${normalizedNameSql('q.specialty_name')}
  LEFT JOIN records named_topic ON assigned_topic.id IS NULL
    AND named_topic.type='qbankTopics' AND named_topic.qbank_id=q.qbank_id
    AND json_extract(named_topic.payload,'$.specialtyId')=coalesce(assigned_specialty.id,named_specialty.id)
    AND ${normalizedNameSql("json_extract(named_topic.payload,'$.name')")}=${normalizedNameSql('q.topic_name')}
)`;

export function classificationCleanupStatements(
  db: D1Database,
  bankIds: Iterable<string>,
  now: string,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const bankId of new Set(bankIds)) {
    if (!bankId) continue;
    const bumpRevision = () => db.prepare(`
      INSERT INTO qbank_classification_revisions(qbank_id,revision,updated_at)
      SELECT ?,1,? WHERE changes()>0
      ON CONFLICT(qbank_id) DO UPDATE SET revision=qbank_classification_revisions.revision+1,updated_at=excluded.updated_at
    `).bind(bankId, now);
    for (const [type, idField, nameField] of [
      ['qbankSpecialties', 'specialtyId', 'specialty'],
      ['qbankTopics', 'topicId', 'topic'],
    ] as const) {
      statements.push(db.prepare(`
        INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at)
        SELECT ?,json_extract(payload,'$.${idField}'),qbank_id,NULL,
          json_object('id',json_extract(payload,'$.${idField}'),'qbankId',qbank_id,
            'name',json_extract(payload,'$.${nameField}'),'order',0,
            'createdAt',?,'updatedAt',?
            ${type === 'qbankTopics' ? ",'specialtyId',json_extract(payload,'$.specialtyId')" : ''}),?
        FROM records WHERE type='sharedQuestions' AND qbank_id=?
          AND coalesce(json_extract(payload,'$.${idField}'),'')<>''
          AND coalesce(json_extract(payload,'$.${nameField}'),'')<>''
          ${type === 'qbankTopics' ? "AND coalesce(json_extract(payload,'$.specialtyId'),'')<>''" : ''}
          ${type === 'qbankSpecialties' ? `AND NOT EXISTS (
            SELECT 1 FROM records topic WHERE topic.type='qbankTopics'
              AND topic.qbank_id=records.qbank_id AND topic.id=json_extract(records.payload,'$.topicId')
              AND json_extract(topic.payload,'$.specialtyId') IS NOT json_extract(records.payload,'$.specialtyId')
          )` : ''}
        GROUP BY json_extract(payload,'$.${idField}')
        ON CONFLICT(type,id) DO NOTHING
      `).bind(type, now, now, now, bankId), bumpRevision());
    }
    statements.push(
      db.prepare(`${occupiedClassification}
        DELETE FROM records WHERE type='qbankTopics' AND qbank_id=?
          AND id NOT IN (SELECT topic_id FROM occupied WHERE topic_id IS NOT NULL)
      `).bind(bankId, bankId), bumpRevision(),
      db.prepare(`${occupiedClassification}
        DELETE FROM records WHERE type='qbankSpecialties' AND qbank_id=?
          AND id NOT IN (SELECT specialty_id FROM occupied WHERE specialty_id IS NOT NULL)
      `).bind(bankId, bankId), bumpRevision(),
    );
  }
  return statements;
}
