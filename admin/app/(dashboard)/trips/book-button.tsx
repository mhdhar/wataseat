'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { createAdminBooking } from './actions';

interface BookButtonProps {
  tripId: string;
}

export function BookButton({ tripId }: BookButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleBook() {
    startTransition(async () => {
      const result = await createAdminBooking(tripId);
      if (result.paymentUrl) {
        window.open(result.paymentUrl, '_blank');
      } else {
        alert(result.error || 'Failed to create booking');
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleBook}
      disabled={isPending}
    >
      {isPending ? 'Creating...' : 'Book'}
    </Button>
  );
}
