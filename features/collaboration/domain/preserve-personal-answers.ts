import type { CollaborationState } from '@/lib/medguard-types';

export function preserveNewerLocalAnswers(
  remote: CollaborationState,
  local: CollaborationState,
  uid: string,
): CollaborationState {
  const answerStats = { ...remote.answerStats };
  for (const [id, localStat] of Object.entries(local.answerStats)) {
    const answer = localStat.selections[uid];
    if (!Number.isInteger(answer)) continue;
    const remoteStat = answerStats[id] ?? localStat;
    answerStats[id] = {
      ...remoteStat,
      selections: { ...remoteStat.selections, [uid]: answer },
    };
  }
  return { ...remote, answerStats };
}
