// Match Array.find's first-match behavior, including malformed duplicate IDs.
export function indexQuestionsById<T extends { id: string }>(questions: readonly T[]): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const question of questions)
    if (!indexed.has(question.id)) indexed.set(question.id, question);
  return indexed;
}
