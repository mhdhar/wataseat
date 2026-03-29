'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateCaptainBankDetails } from '../actions';

interface BankDetailsFormProps {
  captainId: string;
  initialBankName: string;
  initialIban: string;
}

export function BankDetailsForm({
  captainId,
  initialBankName,
  initialIban,
}: BankDetailsFormProps) {
  const [bankName, setBankName] = useState(initialBankName);
  const [iban, setIban] = useState(initialIban);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    startTransition(async () => {
      const result = await updateCaptainBankDetails(captainId, bankName.trim(), iban.trim());
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="bank-name">Bank Name</Label>
        <Input
          id="bank-name"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          placeholder="e.g. Emirates NBD"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="iban">IBAN</Label>
        <Input
          id="iban"
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          placeholder="e.g. AE070331234567890123456"
          className="font-mono"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending} size="sm">
          {isPending ? 'Saving...' : 'Save Bank Details'}
        </Button>
        {saved && (
          <span className="text-sm text-green-600">Saved successfully</span>
        )}
      </div>
    </form>
  );
}
