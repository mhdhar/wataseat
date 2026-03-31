'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { refundBooking } from './actions';

interface RefundButtonProps {
  bookingId: string;
  guestName: string;
  amount: string;
}

export function RefundButton({ bookingId, guestName, amount }: RefundButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleConfirm() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await refundBooking(bookingId);
      if ('success' in result) {
        setOpen(false);
      } else {
        setErrorMessage(result.error);
        // Do NOT close dialog — keep button enabled for retry (D-04)
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setErrorMessage(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        Refund
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Refund</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to refund{' '}
            <span className="font-medium text-foreground">{amount}</span> to{' '}
            <span className="font-medium text-foreground">{guestName}</span>?
            This action cannot be undone.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? 'Processing...' : 'Confirm Refund'}
          </Button>
        </DialogFooter>
        {errorMessage && (
          <p className="mt-2 text-sm text-red-600">{errorMessage}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
