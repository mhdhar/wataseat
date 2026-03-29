import { getPendingPayouts, getPayoutHistory } from '@/lib/queries';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { MarkAsPaidButton } from './mark-as-paid-button';

export const dynamic = 'force-dynamic';

function formatAED(amount: number | string): string {
  return `${Number(amount).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-AE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default async function PayoutsPage() {
  const [pending, history] = await Promise.all([
    getPendingPayouts(),
    getPayoutHistory(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payouts</h1>
        <p className="text-muted-foreground mt-1">
          Manage captain payouts and track payment history.
        </p>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">
            Queue{pending.length > 0 && ` (${pending.length})`}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4">
          {pending.length === 0 ? (
            <div className="rounded-md border p-8 text-center">
              <p className="text-sm text-muted-foreground">No pending payouts</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trip</TableHead>
                    <TableHead>Captain</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Payout</TableHead>
                    <TableHead>IBAN</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((payout) => {
                    const captain = payout.captains as {
                      display_name: string;
                      iban: string | null;
                      bank_name: string | null;
                      whatsapp_id: string;
                    } | null;
                    const trip = payout.trips as {
                      title: string;
                      trip_type: string;
                      departure_at: string;
                    } | null;

                    return (
                      <TableRow key={payout.id}>
                        <TableCell className="font-medium">
                          {trip?.title ?? 'Unknown'}
                          {trip?.trip_type && (
                            <Badge variant="outline" className="ml-2">
                              {trip.trip_type}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{captain?.display_name ?? 'Unknown'}</TableCell>
                        <TableCell>
                          {trip?.departure_at ? formatDate(trip.departure_at) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatAED(payout.gross_amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatAED(payout.commission_amount)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatAED(payout.payout_amount)}
                        </TableCell>
                        <TableCell>
                          <div className="text-xs">
                            <span className="font-mono">{captain?.iban ?? '-'}</span>
                            {captain?.bank_name && (
                              <span className="block text-muted-foreground">
                                {captain.bank_name}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <MarkAsPaidButton
                            payoutId={payout.id}
                            captainName={captain?.display_name ?? 'Captain'}
                            amount={formatAED(payout.payout_amount)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {history.length === 0 ? (
            <div className="rounded-md border p-8 text-center">
              <p className="text-sm text-muted-foreground">No payout history</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date Processed</TableHead>
                    <TableHead>Captain</TableHead>
                    <TableHead>Trip</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Bank Reference</TableHead>
                    <TableHead className="text-center">WhatsApp Notified</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((payout) => {
                    const captain = payout.captains as {
                      display_name: string;
                    } | null;
                    const trip = payout.trips as { title: string } | null;

                    return (
                      <TableRow key={payout.id}>
                        <TableCell>
                          {payout.processed_at
                            ? formatDate(payout.processed_at)
                            : '-'}
                        </TableCell>
                        <TableCell>{captain?.display_name ?? 'Unknown'}</TableCell>
                        <TableCell>{trip?.title ?? 'Unknown'}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatAED(payout.payout_amount)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {payout.bank_reference ?? '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          {payout.whatsapp_notified ? (
                            <Badge variant="default">Sent</Badge>
                          ) : (
                            <Badge variant="destructive">Failed</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
