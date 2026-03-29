'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { adminCancelTrip } from '../actions';

interface CancelTripButtonProps {
  tripId: string;
}

export function CancelTripButton({ tripId }: CancelTripButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function handleCancel() {
    startTransition(async () => {
      await adminCancelTrip(tripId);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>
        Cancel Trip
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this trip?</DialogTitle>
          <DialogDescription>
            This will cancel the trip and all associated bookings. Guests with
            authorized payments will have their holds released. This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Keep Trip
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={isPending}
          >
            {isPending ? 'Cancelling...' : 'Yes, Cancel Trip'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
