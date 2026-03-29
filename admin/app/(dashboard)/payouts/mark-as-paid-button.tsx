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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { markPayoutProcessed } from './actions';

interface MarkAsPaidButtonProps {
  payoutId: string;
  captainName: string;
  amount: string;
}

export function MarkAsPaidButton({
  payoutId,
  captainName,
  amount,
}: MarkAsPaidButtonProps) {
  const [open, setOpen] = useState(false);
  const [bankReference, setBankReference] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bankReference.trim()) return;

    startTransition(async () => {
      const result = await markPayoutProcessed(payoutId, bankReference.trim());
      if (result.success) {
        setOpen(false);
        setBankReference('');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        Mark as Paid
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Confirm Payout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Marking payout of <span className="font-medium text-foreground">{amount}</span> to{' '}
              <span className="font-medium text-foreground">{captainName}</span> as processed.
            </p>
            <div className="space-y-2">
              <Label htmlFor="bank-reference">Bank Reference Number</Label>
              <Input
                id="bank-reference"
                placeholder="e.g. TRF-20260329-001"
                value={bankReference}
                onChange={(e) => setBankReference(e.target.value)}
                required
              />
            </div>
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
            <Button type="submit" disabled={isPending || !bankReference.trim()}>
              {isPending ? 'Processing...' : 'Confirm Payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
