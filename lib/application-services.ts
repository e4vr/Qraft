// Transitional composition surface for the root application. Feature modules are
// the canonical owners; this facade keeps existing UI imports stable in Phase 1.
export {
  beginTotpEnrollment,
  changeCloudflarePassword,
  completeCloudflareMfaSignIn,
  completeTotpEnrollment,
  createCloudflareAccount,
  observeCloudflareUser,
  setAuthenticatedUserCache,
  signInCloudflare,
  signOutCloudflare,
  updateCloudflareProfile,
} from '@/features/auth/client/auth-client';
export {
  flushPendingCollaborationState,
  loadCollaborationState,
  queueCollaborationState,
  saveCollaborationState,
} from '@/features/collaboration/client/collaboration-client';
export { registerStartedExam } from '@/features/exams/client/exam-client';
export {
  deleteQBankImages,
  joinCloudflareQBankByLink,
  previewCloudflareQBankInvitation,
  reserveQuestionIds,
  uploadNoteImage,
  uploadQuestionImage,
  type QBankLinkInvitation,
} from '@/features/qbanks/client/qbank-client';
export {
  flushPendingCloudState,
  loadCloudState,
  observeCloudStateSync,
  saveBestEffortStateCheckpoint,
  saveCloudState,
  saveDailyGoal,
  saveExamCheckpoint,
  saveFlashcardCheckpoint,
} from '@/features/state/client/state-sync-client';
export {
  deleteClassificationDraft,
  loadClassificationDraft,
  loadLocalCollaboration,
  loadCollaborationSyncOutbox,
  loadLocalState,
  saveClassificationDraft,
  saveLocalCollaboration,
  saveLocalState,
} from './local-db';
