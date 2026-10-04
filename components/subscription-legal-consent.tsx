import { ExternalLink, FileText, LockKeyhole, RotateCcw, ShieldCheck } from 'lucide-react';
import type { LegalLinks } from '@/lib/legal-links';

export function SubscriptionLegalConsent({ links, accepted, busy, ready, error, onChange, onRetry }: {
  links: LegalLinks;
  accepted: boolean;
  busy: boolean;
  ready: boolean;
  error: string;
  onChange: (accepted: boolean) => void;
  onRetry: () => void;
}) {
  const policies = [
    { label: 'شروط الاستخدام', url: links.termsUrl, icon: FileText },
    { label: 'سياسة الخصوصية', url: links.privacyUrl, icon: LockKeyhole },
    { label: 'شروط الاسترجاع', url: links.refundUrl, icon: RotateCcw },
  ].filter(policy => policy.url);

  return (
    <section className="q-subscription-legal" dir="rtl" lang="ar" aria-label="الشروط والسياسات">
      <div className="q-subscription-legal-heading">
        <span className="q-subscription-legal-icon"><ShieldCheck aria-hidden="true" className="size-5" /></span>
        <div>
          <h2>الشروط والسياسات</h2>
          <p>راجع السياسات التالية قبل تأكيد اشتراكك.</p>
        </div>
      </div>
      <nav className="q-subscription-policy-links" aria-label="سياسات الاشتراك">
        {policies.map(({ label, url, icon: Icon }) => (
          <a key={label} href={url} target="_blank" rel="noopener noreferrer">
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span>{label}</span>
            <ExternalLink aria-hidden="true" className="q-subscription-policy-external size-3.5 shrink-0" />
            <span className="sr-only"> (يفتح في نافذة جديدة)</span>
          </a>
        ))}
      </nav>
      <label className={`q-subscription-consent ${accepted ? 'is-accepted' : ''} ${busy || !ready ? 'is-disabled' : ''}`}>
        <input type="checkbox" checked={accepted} disabled={busy || !ready} onChange={event => onChange(event.target.checked)} />
        <span>لقد قرأت جميع الشروط والأحكام وأوافق عليها.</span>
      </label>
      {!ready && !error && <output className="q-subscription-policy-status" aria-live="polite">جارٍ تحميل السياسات…</output>}
      {error && <div className="mt-3 text-sm" dir="auto">
        <p role="alert" className="text-destructive">{error}</p>
        <button type="button" className="q-button q-button-secondary mt-2" onClick={onRetry}>إعادة المحاولة</button>
      </div>}
    </section>
  );
}
