import type { AppState, AppUser, CollaborationState } from './medguard-types';
import {
  beginTotpEnrollment,
  changeCloudflarePassword,
  completeCloudflareMfaSignIn,
  completeTotpEnrollment,
  createCloudflareAccount,
  deleteQBankImages,
  joinCloudflareQBankByLink,
  loadCloudState,
  loadCollaborationState,
  observeCloudflareUser,
  previewCloudflareQBankInvitation,
  registerStartedExam,
  reserveQuestionIds,
  saveCloudState,
  saveCollaborationState,
  signInCloudflare,
  signOutCloudflare,
  updateCloudflareProfile,
  uploadNoteImage,
  uploadQuestionImage,
} from './cloudflare-client';
import {
  loadLocalCollaboration,
  loadLocalState,
  saveLocalCollaboration,
  saveLocalState,
} from './local-db';

export {
  beginTotpEnrollment,
  changeCloudflarePassword,
  completeCloudflareMfaSignIn,
  completeTotpEnrollment,
  createCloudflareAccount,
  deleteQBankImages,
  joinCloudflareQBankByLink,
  loadCloudState,
  loadCollaborationState,
  observeCloudflareUser,
  previewCloudflareQBankInvitation,
  registerStartedExam,
  reserveQuestionIds,
  saveCloudState,
  saveCollaborationState,
  signInCloudflare,
  signOutCloudflare,
  updateCloudflareProfile,
  uploadNoteImage,
  uploadQuestionImage,
};
export type { QBankLinkInvitation } from './cloudflare-client';
export {
  loadLocalCollaboration,
  loadLocalState,
  saveLocalCollaboration,
  saveLocalState,
};

export interface AuthService {
  observe(callback: (user?: AppUser) => void): Promise<() => void>;
  signIn(email: string, password: string): Promise<AppUser>;
  signUp(name: string, email: string, password: string, universityId: string, phone: string, setupToken?: string): Promise<AppUser>;
  signOut(): Promise<void>;
}

export interface UserStateRepository {
  loadRemote(userId: string): Promise<AppState | undefined>;
  saveRemote(userId: string, state: AppState): Promise<void>;
  loadLocal(userId: string): Promise<AppState | undefined>;
  saveLocal(userId: string, state: AppState): Promise<void>;
}

export interface CollaborationRepository {
  loadRemote(user: AppUser): Promise<CollaborationState>;
  saveRemote(next: CollaborationState, previous: CollaborationState): Promise<void>;
  loadLocal(userId: string): Promise<CollaborationState | undefined>;
  saveLocal(state: CollaborationState, userId: string): Promise<void>;
}

export const authService: AuthService = {
  observe: observeCloudflareUser,
  signIn: signInCloudflare,
  signUp: createCloudflareAccount,
  signOut: signOutCloudflare,
};

export const userStateRepository: UserStateRepository = {
  loadRemote: loadCloudState,
  saveRemote: saveCloudState,
  loadLocal: loadLocalState,
  saveLocal: saveLocalState,
};

export const collaborationRepository: CollaborationRepository = {
  loadRemote: loadCollaborationState,
  saveRemote: saveCollaborationState,
  loadLocal: loadLocalCollaboration,
  saveLocal: saveLocalCollaboration,
};

export const assetService = {
  uploadNoteImage,
  uploadQuestionImage,
  deleteQBankImages,
};

export const qbankRepository = {
  joinByLink: joinCloudflareQBankByLink,
  previewInvitation: previewCloudflareQBankInvitation,
  reserveQuestionIds,
};

export const accountService = {
  beginTotpEnrollment,
  completeMfaSignIn: completeCloudflareMfaSignIn,
  completeTotpEnrollment,
  changePassword: changeCloudflarePassword,
  updateProfile: updateCloudflareProfile,
};
