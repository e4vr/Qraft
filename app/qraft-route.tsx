import MedGuardApp, { type QraftView } from '@/components/medguard-app';

export function QraftRoute({
  view,
  testId,
  qbankId,
}: {
  view: QraftView;
  testId?: string;
  qbankId?: string;
}) {
  return <MedGuardApp initialView={view} initialTestId={testId} initialQBankId={qbankId} />;
}

