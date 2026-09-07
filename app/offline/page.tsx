'use client';

import { SystemStatePage } from '@/components/system-state-page';

export default function OfflinePage() {
  return (
    <SystemStatePage
      kind="offline"
      onRetry={() => window.location.replace('/')}
    />
  );
}
