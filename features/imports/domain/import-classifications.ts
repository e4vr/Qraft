import type { QBankSpecialty, QBankTopic } from '@/lib/medguard-types';

export interface ImportClassificationCatalog {
  specialties: string[];
  topics: Array<{ specialty: string; name: string }>;
}
export const classificationNameKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const displayName = (name: unknown) => typeof name === 'string' && name.length <= 240 ? name.trim().replace(/\s+/g, ' ') : '';

export function mergeImportClassifications(...sources: unknown[]): ImportClassificationCatalog {
  const specialties = new Map<string, string>(), topics = new Map<string, { specialty: string; name: string }>();
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const catalog = source as Partial<ImportClassificationCatalog>;
    for (const raw of Array.isArray(catalog.specialties) ? catalog.specialties : []) {
      const name = displayName(raw); if (name) specialties.set(classificationNameKey(name), specialties.get(classificationNameKey(name)) ?? name);
    }
    for (const raw of Array.isArray(catalog.topics) ? catalog.topics : []) {
      const specialty = displayName(raw?.specialty), name = displayName(raw?.name);
      if (!specialty || !name) continue;
      const key = classificationNameKey(specialty); specialties.set(key, specialties.get(key) ?? specialty);
      const pair = JSON.stringify([key, classificationNameKey(name)]);
      if (!topics.has(pair)) topics.set(pair, { specialty: specialties.get(key)!, name });
    }
  }
  return { specialties: [...specialties.values()], topics: [...topics.values()] };
}

export function importBankClassifications(bankId: string, specialties: QBankSpecialty[], topics: QBankTopic[]) {
  const scoped = specialties.filter(item => item.qbankId === bankId);
  const byId = new Map(scoped.map(item => [item.id, item.name]));
  return mergeImportClassifications({ specialties: scoped.map(item => item.name), topics: topics.filter(item => item.qbankId === bankId && byId.has(item.specialtyId)).map(item => ({ specialty: byId.get(item.specialtyId), name: item.name })) });
}

export function importQuestionClassifications(questions: Array<{ specialty: string; topic: string }>) {
  return mergeImportClassifications({ specialties: questions.map(q => q.specialty), topics: questions.map(q => ({ specialty: q.specialty, name: q.topic })) });
}

export function importTopicNames(catalog: ImportClassificationCatalog, specialty: string) {
  const key = classificationNameKey(specialty), names = new Map<string, string>();
  for (const item of catalog.topics) if (!key || classificationNameKey(item.specialty) === key) {
    const topicKey = classificationNameKey(item.name);
    if (!names.has(topicKey)) names.set(topicKey, item.name);
  }
  return [...names.values()];
}

// Search tolerates accents/Arabic vowel marks, while stored names keep their spelling.
export function classificationSuggestions(names: string[], query: string, limit = 12) {
  const searchKey = (value: string) => classificationNameKey(value).normalize('NFD').replace(/\p{M}/gu, '');
  const needle = searchKey(query);
  return names.map(name => ({ name, key: searchKey(name) })).filter(item => !needle || item.key.includes(needle))
    .sort((a, b) => {
      const rank = (key: string) => key === needle ? 0 : key.startsWith(needle) ? 1 : 2;
      return rank(a.key) - rank(b.key) || a.name.localeCompare(b.name);
    }).slice(0, limit).map(item => item.name);
}
