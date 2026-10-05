export interface RegistrationPolicy {
  autoApproveUniversityIds: boolean;
  revision: number;
  updatedAt: string | null;
}

export const REGISTRATION_POLICY_ID = 'registrationPolicy';
export const DEFAULT_REGISTRATION_POLICY: RegistrationPolicy = {
  autoApproveUniversityIds: false,
  revision: 0,
  updatedAt: null,
};

export function normalizeRegistrationPolicy(
  value: Partial<RegistrationPolicy>,
): RegistrationPolicy {
  return {
    autoApproveUniversityIds: value.autoApproveUniversityIds === true,
    revision:
      Number.isSafeInteger(value.revision) && value.revision! >= 0
        ? value.revision!
        : 0,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  };
}
