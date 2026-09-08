import type { Metadata } from 'next';
import MedGuardApp from '@/components/medguard-app';

export const metadata: Metadata = {
  title: 'Superadmin | Qraft',
  robots: { index: false, follow: false },
};

export default function SuperadminPage() {
  return <MedGuardApp portal="superadmin" />;
}
