export interface LegalLinks {
  termsUrl: string;
  privacyUrl: string;
  refundUrl: string;
}

export const DEFAULT_LEGAL_LINKS: LegalLinks = {
  termsUrl: '',
  privacyUrl: '',
  refundUrl: 'https://qraftbank.netlify.app/policies/refund.html',
};
