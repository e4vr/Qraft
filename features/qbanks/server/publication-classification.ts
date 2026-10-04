import type { QBankSpecialty, QBankTopic, Question } from '@/lib/medguard-types';

// Pending proposals can outlive the last question in their old classification.
// Reuse current names/IDs on publication so this cannot create duplicate topics.
export async function publicationClassificationResolver(db: D1Database, bankIds: Iterable<string>) {
  const ids = [...new Set(bankIds)];
  const rows = await db.prepare(`SELECT type,payload FROM records
    WHERE qbank_id IN (SELECT value FROM json_each(?)) AND type IN ('qbankSpecialties','qbankTopics')`)
    .bind(JSON.stringify(ids)).all<{ type: string; payload: string }>();
  type SpecialtyIdentity = Pick<QBankSpecialty, 'id' | 'qbankId' | 'name'>;
  type TopicIdentity = Pick<QBankTopic, 'id' | 'qbankId' | 'name' | 'specialtyId'>;
  const specialties = rows.results.filter(row => row.type === 'qbankSpecialties').map(row => JSON.parse(row.payload) as SpecialtyIdentity);
  const topics = rows.results.filter(row => row.type === 'qbankTopics').map(row => JSON.parse(row.payload) as TopicIdentity);
  const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const key = (...values: string[]) => JSON.stringify(values);
  const specialtyById = new Map(specialties.map(item => [key(item.qbankId, item.id), item]));
  const topicById = new Map(topics.map(item => [key(item.qbankId, item.id), item]));
  const specialtyByName = new Map(specialties.map(item => [key(item.qbankId, normalize(item.name)), item]));
  const topicByName = new Map(topics.map(item => [key(item.qbankId, item.specialtyId, normalize(item.name)), item]));
  return (question: Question): Question => {
    const bankId = question.qbankId ?? 'smle-gs';
    const existingTopic = question.topicId ? topicById.get(key(bankId, question.topicId)) : undefined;
    const specialtyId = existingTopic?.specialtyId ?? question.specialtyId;
    let specialty = (specialtyId ? specialtyById.get(key(bankId, specialtyId)) : undefined)
      ?? specialtyByName.get(key(bankId, normalize(question.specialty)));
    if (!specialty) {
      specialty = { id: specialtyId ?? crypto.randomUUID(), qbankId: bankId, name: question.specialty };
      specialtyById.set(key(bankId, specialty.id), specialty);
      specialtyByName.set(key(bankId, normalize(specialty.name)), specialty);
    }
    let topic = existingTopic ?? topicByName.get(key(bankId, specialty.id, normalize(question.topic)));
    if (!topic) {
      topic = { id: question.topicId ?? crypto.randomUUID(), qbankId: bankId, specialtyId: specialty.id, name: question.topic };
      topicById.set(key(bankId, topic.id), topic);
      topicByName.set(key(bankId, specialty.id, normalize(topic.name)), topic);
    }
    return { ...question, specialtyId: specialty.id, topicId: topic.id };
  };
}
