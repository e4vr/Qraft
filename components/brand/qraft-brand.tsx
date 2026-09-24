'use client';

import { cn } from '@/lib/utils';
import Image from 'next/image';

export const QRAFT_MARK_ASSET = '/qraft-mark.svg';
export const QRAFT_WORDMARK_ASSET = '/qraft-wordmark.svg';

export function QraftBrand({
  variant = 'wordmark',
  className,
  label = 'Qraft',
  tone = 'full-color',
}: {
  variant?: 'mark' | 'wordmark';
  className?: string;
  label?: string;
  tone?: 'full-color' | 'adaptive';
}) {
  if (variant === 'mark') {
    return (
      <Image
        src={QRAFT_MARK_ASSET}
        alt={label}
        width={333}
        height={354}
        className={cn('q-brand-mark block object-contain', className)}
      />
    );
  }

  return (
    <span className={cn('q-brand-wordmark relative block', className)}>
      <Image
        src={QRAFT_WORDMARK_ASSET}
        alt=""
        aria-hidden="true"
        width={1095}
        height={354}
        className={cn(
          'block h-full w-full object-contain',
          tone === 'adaptive' && 'dark:hidden',
        )}
      />
      {tone === 'adaptive' && (
        <span
          aria-hidden="true"
          className="hidden h-full w-full bg-gradient-to-r from-cyan-200 via-teal-200 to-sky-100 dark:block"
          style={{
            WebkitMaskImage: `url('${QRAFT_WORDMARK_ASSET}')`,
            maskImage: `url('${QRAFT_WORDMARK_ASSET}')`,
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
          }}
        />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
