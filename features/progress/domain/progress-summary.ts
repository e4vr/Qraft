import type { AppState, QBankSpecialty, QBankTopic, Question, TestBuilderConfig } from '@/lib/medguard-types';
import { availableExamQuestionLimit } from '@/features/exams/domain/exam-presenters';
import { groupQuestionsByQBankClassification } from './qbank-classification';

export interface ProgressTopicSummary {
  id: string;
  specialtyId: string;
  specialty: string;
  topic: string;
  total: number;
  completed: number;
  correct: number;
  accuracy: number;
  studyTopics: NonNullable<TestBuilderConfig['includedTopics']>;
}

export function summarizeProgress(
  progress: AppState['progress'], questions: Question[],
  specialties: QBankSpecialty[], topics: QBankTopic[],
) {
  const performance = (pool: Question[]) => {
    let completed = 0, correct = 0;
    for (const question of pool) {
      const answer = progress[question.id];
      if (!answer || answer.attempts <= 0) continue;
      completed++;
      if (answer.lastAnswer === question.answer) correct++;
    }
    return { total: pool.length, completed, correct, accuracy: completed ? Math.round(correct * 100 / completed) : 0 };
  };
  const specialtyById = new Map(specialties.map(item => [item.id, item]));
  const topicById = new Map(topics.map(item => [item.id, item]));
  const categories = groupQuestionsByQBankClassification(questions, specialties, topics).map(group => ({
    id: group.id, category: group.name, ...performance(group.questions),
    topics: group.topics.map(topicGroup => {
      const studyTopics = new Map<string, NonNullable<TestBuilderConfig['includedTopics']>[number]>();
      for (const question of topicGroup.questions) {
        const assignedTopic = topicById.get(question.topicId ?? '');
        const assignedSpecialty = specialtyById.get(assignedTopic?.specialtyId ?? question.specialtyId ?? '');
        const selection = {
          specialty: assignedSpecialty?.name ?? question.specialty,
          topic: assignedTopic?.name ?? question.topic,
          specialtyId: assignedSpecialty?.id ?? null,
          topicId: assignedTopic?.id ?? null,
        };
        studyTopics.set(JSON.stringify(selection), selection);
      }
      return {
        id: topicGroup.id, specialtyId: group.id, specialty: group.name, topic: topicGroup.name,
        ...performance(topicGroup.questions), studyTopics: [...studyTopics.values()],
      } satisfies ProgressTopicSummary;
    }),
  }));
  const overall = performance(questions);
  const areasToImprove = categories.flatMap(category => category.topics)
    .filter(topic => topic.completed > 0 && topic.accuracy < 75)
    .sort((a, b) => a.accuracy - b.accuracy || b.completed - a.completed || a.specialty.localeCompare(b.specialty) || a.topic.localeCompare(b.topic));
  return { ...overall, incorrect: overall.completed - overall.correct,
    flagged: questions.filter(question => progress[question.id]?.flagged).length,
    categories, areasToImprove };
}

export function topicStudyConfig(topic: ProgressTopicSummary, maxQuestions: number): TestBuilderConfig | null {
  const count = availableExamQuestionLimit(topic.total, maxQuestions);
  if (!count || !topic.studyTopics.length) return null;
  return { mode: 'tutor', statuses: [], specialty: '', topics: [], includedTopics: topic.studyTopics, randomAll: false, count };
}
