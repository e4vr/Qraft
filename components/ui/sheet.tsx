'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  children,
  className,
  showClose = true,
  ...props
}: DialogPrimitive.Popup.Props & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="q-sheet-backdrop" />
      <DialogPrimitive.Popup className={cn('q-sheet', className)} {...props}>
        <div className="q-sheet-grabber" aria-hidden="true" />
        {children}
        {showClose && (
          <DialogPrimitive.Close className="q-sheet-close" aria-label="Close">
            <X className="size-5" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'header'>) {
  return <header className={cn('q-sheet-header', className)} {...props} />;
}

export function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('q-sheet-body', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'footer'>) {
  return <footer className={cn('q-sheet-footer', className)} {...props} />;
}

