import type { QBankSpecialty, QBankTopic, Question } from '@/lib/medguard-types';

export interface ProgressTopicGroup {
  id: string;
  name: string;
  questions: Question[];
}

export interface ProgressSpecialtyGroup {
  id: string;
  name: string;
  questions: Question[];
  topics: ProgressTopicGroup[];
}

function classificationName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function classificationKey(value: string): string {
  return classificationName(value).toLocaleLowerCase('en-US');
}

function ordered<T extends { order: number; name: string }>(items: T[]): T[] {
  return [...items].sort(
    (left, right) => left.order - right.order || left.name.localeCompare(right.name),
  );
}

export function groupQuestionsByQBankClassification(
  questions: Question[],
  specialties: QBankSpecialty[],
  topics: QBankTopic[],
): ProgressSpecialtyGroup[] {
  const specialtyById = new Map(specialties.map((item) => [item.id, item]));
  const topicById = new Map(topics.map((item) => [item.id, item]));
  const groups = ordered(specialties).map((specialty) => ({
    id: specialty.id,
    name: specialty.name,
    questions: [] as Question[],
    topics: ordered(topics.filter((topic) => topic.specialtyId === specialty.id)).map(
      (topic) => ({ id: topic.id, name: topic.name, questions: [] as Question[] }),
    ),
  }));
  const groupById = new Map(groups.map((group) => [group.id, group]));

  for (const question of questions) {
    const assignedTopic = question.topicId ? topicById.get(question.topicId) : undefined;
    const assignedSpecialty = assignedTopic
      ? specialtyById.get(assignedTopic.specialtyId)
      : question.specialtyId
        ? specialtyById.get(question.specialtyId)
        : undefined;
    const specialty = assignedSpecialty ?? specialties.find(
      (item) => classificationKey(item.name) === classificationKey(question.specialty),
    );
    const specialtyName = specialty?.name ?? (classificationName(question.specialty) || 'Unclassified');
    const specialtyKey = specialty?.id ?? `unclassified-specialty:${classificationKey(specialtyName)}`;
    let group = groupById.get(specialtyKey);
    if (!group) {
      group = { id: specialtyKey, name: specialtyName, questions: [], topics: [] };
      groupById.set(specialtyKey, group);
      groups.push(group);
    }

    const topic = assignedTopic?.specialtyId === specialty?.id
      ? assignedTopic
      : topics.find(
          (item) => item.specialtyId === specialty?.id &&
            classificationKey(item.name) === classificationKey(question.topic),
        );
    const topicName = topic?.name ?? (classificationName(question.topic) || 'Unclassified');
    const topicKey = topic?.id ?? `unclassified-topic:${classificationKey(topicName)}`;
    let topicGroup = group.topics.find((item) => item.id === topicKey);
    if (!topicGroup) {
      topicGroup = { id: topicKey, name: topicName, questions: [] };
      group.topics.push(topicGroup);
    }
    group.questions.push(question);
    topicGroup.questions.push(question);
  }

  return groups.filter((group) => group.questions.length > 0).map((group) => ({
    ...group,
    topics: group.topics.filter((topic) => topic.questions.length > 0),
  }));
}

export function occupiedQBankClassification(
  questions: Question[],
  specialties: QBankSpecialty[],
  topics: QBankTopic[],
) {
  const groups = groupQuestionsByQBankClassification(questions, specialties, topics);
  const specialtyIds = new Set(groups.map((group) => group.id));
  const topicIds = new Set(groups.flatMap((group) => group.topics.map((topic) => topic.id)));
  return {
    specialties: specialties.filter((item) => specialtyIds.has(item.id)),
    topics: topics.filter((item) => topicIds.has(item.id)),
  };
}
