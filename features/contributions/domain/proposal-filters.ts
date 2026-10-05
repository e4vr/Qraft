import type { ProposalEditKind, QuestionProposal } from '@/lib/medguard-types';

export const PROPOSAL_EDIT_KINDS = [
  ['question_text', 'Question text'],
  ['options', 'Answer options'],
  ['correct_answer', 'Incorrect answer key'],
  ['explanation', 'Explanation issue'],
  ['source', 'Source / reference issue'],
  ['typo_formatting', 'Typo / formatting'],
  ['duplicate', 'Duplicate question'],
  ['outdated_guideline', 'Outdated guideline'],
  ['missing_information', 'Missing information'],
  ['image_media', 'Image / media issue'],
  ['other', 'Other'],
] as const satisfies ReadonlyArray<readonly [ProposalEditKind, string]>;

export type ReviewCategory = 'all' | 'new' | 'edits' | 'duplicates';
export type ReportKindFilter = 'all' | ProposalEditKind;

export function proposalEditKindLabel(kind: ProposalEditKind): string {
  return (
    PROPOSAL_EDIT_KINDS.find(([value]) => value === kind)?.[1] ??
    kind.replaceAll('_', ' ')
  );
}

export function matchesProposalFilters(
  proposal: Pick<QuestionProposal, 'type' | 'editKinds'>,
  category: ReviewCategory,
  kind: ReportKindFilter,
  hasDuplicateCandidates: boolean,
): boolean {
  const duplicate =
    hasDuplicateCandidates || proposal.editKinds.includes('duplicate');
  const matchesCategory =
    category === 'all' ||
    (category === 'new' && proposal.type === 'new_question') ||
    (category === 'edits' && proposal.type === 'question_edit' && !duplicate) ||
    (category === 'duplicates' && duplicate);
  // The report classification applies to edit requests, not new questions.
  return (
    matchesCategory &&
    (category === 'new' ||
      kind === 'all' ||
      (proposal.type === 'question_edit' && proposal.editKinds.includes(kind)))
  );
}
