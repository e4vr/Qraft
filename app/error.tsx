'use client';

import { useEffect } from 'react';
import { SystemStatePage } from '@/components/system-state-page';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        event: 'qraft_render_error',
        digest: error.digest,
        message: error.message,
      }),
    );
  }, [error]);
  return <SystemStatePage kind="error" onRetry={reset} />;
}
