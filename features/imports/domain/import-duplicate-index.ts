import type { PreparedDuplicateCandidate } from '@/features/duplicates/domain/duplicate-detection';

export class ImportDuplicateIndex {
  private stems = new Map<string, PreparedDuplicateCandidate[]>();
  private words = new Map<string, Set<PreparedDuplicateCandidate>>();
  constructor(candidates: PreparedDuplicateCandidate[] = []) { candidates.forEach(candidate => this.add(candidate)); }
  add(candidate: PreparedDuplicateCandidate) {
    const key = `${candidate.qbankId}\u0000${candidate.prepared.stem}`;
    const existing = this.stems.get(key);
    if (existing) existing.push(candidate); else this.stems.set(key, [candidate]);
    for (const word of new Set(candidate.prepared.stem.match(/[\p{L}\p{N}]+/gu) ?? [])) {
      const wordKey = `${candidate.qbankId}\u0000${word}`;
      let list = this.words.get(wordKey);
      if (!list) { list = new Set(); this.words.set(wordKey, list); }
      list.add(candidate);
    }
  }
  exact(bankId: string, stem: string) { return this.stems.get(`${bankId}\u0000${stem}`) ?? []; }
  near(bankId: string, stem: string) {
    const scores = new Map<PreparedDuplicateCandidate, number>();
    for (const word of new Set(stem.match(/[\p{L}\p{N}]+/gu) ?? [])) {
      const candidates = this.words.get(`${bankId}\u0000${word}`);
      if (!candidates) continue;
      for (const candidate of candidates) scores.set(candidate, (scores.get(candidate) ?? 0) + 1 / candidates.size);
    }
    return [...scores].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([candidate]) => candidate);
  }
}
