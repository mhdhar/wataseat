'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { toggleSuspendCaptain } from '../actions';

interface SuspendButtonProps {
  captainId: string;
  isSuspended: boolean;
}

export function SuspendButton({ captainId, isSuspended }: SuspendButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await toggleSuspendCaptain(captainId, !isSuspended);
    });
  }

  return (
    <Button
      variant={isSuspended ? 'default' : 'destructive'}
      size="sm"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending
        ? 'Updating...'
        : isSuspended
          ? 'Reactivate Captain'
          : 'Suspend Captain'}
    </Button>
  );
}
