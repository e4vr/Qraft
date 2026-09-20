'use client';

import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { usePresentationEnvironment } from '@/features/presentation/presentation-context';
import { cn } from '@/lib/utils';

export function AdaptiveOverlay({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { mode } = usePresentationEnvironment();
  if (mode === 'handheld')
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className={className}>
          <SheetHeader>
            <SheetTitle className="text-base font-bold">{title}</SheetTitle>
            {description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>}
          </SheetHeader>
          <SheetBody>{children}</SheetBody>
        </SheetContent>
      </Sheet>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('sm:max-w-2xl', className)}>
        <DialogTitle>{title}</DialogTitle>
        {description && <p className="text-sm leading-6 text-muted-foreground">{description}</p>}
        {children}
      </DialogContent>
    </Dialog>
  );
}

