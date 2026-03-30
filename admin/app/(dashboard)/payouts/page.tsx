import Link from 'next/link';
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
import { CopyButton } from '@/components/copy-button';
import { SortableHeader } from '@/components/sortable-header';
import { sortData } from '@/lib/sort';

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

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; order?: string }>;
}) {
  const params = await searchParams;
  const sort = params.sort || null;
  const order = params.order || null;
  const [rawPending, rawHistory] = await Promise.all([
    getPendingPayouts(),
    getPayoutHistory(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payoutSorter = (item: any, key: string) => {
    if (key === 'captain') return (item.captains as { display_name: string } | null)?.display_name;
    if (key === 'trip') return (item.trips as { title: string } | null)?.title;
    if (key === 'date') return item.created_at;
    if (key === 'gross') return Number(item.gross_amount);
    if (key === 'commission') return Number(item.commission_amount);
    if (key === 'payout') return Number(item.payout_amount);
    return item[key];
  };

  const pending = sortData(rawPending, sort, order, payoutSorter);
  const history = sortData(rawHistory, sort, order, payoutSorter);

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
                    <SortableHeader column="trip" label="Trip" />
                    <SortableHeader column="captain" label="Captain" />
                    <SortableHeader column="date" label="Date" />
                    <SortableHeader column="gross" label="Gross" className="text-right" />
                    <SortableHeader column="commission" label="Commission" className="text-right" />
                    <SortableHeader column="payout" label="Payout" className="text-right" />
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
                          <Link href={`/trips/${payout.trip_id}`} className="hover:underline">
                            {trip?.title ?? 'Unknown'}
                          </Link>
                          {trip?.trip_type && (
                            <Badge variant="outline" className="ml-2">
                              {trip.trip_type}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Link href={`/captains/${payout.captain_id}`} className="font-medium hover:underline">
                              {captain?.display_name || 'Unknown'}
                            </Link>
                            {captain?.display_name && (
                              <CopyButton text={captain.display_name} label="" className="!p-0.5" />
                            )}
                          </div>
                        </TableCell>
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
                            {captain?.iban ? (
                              <CopyButton text={captain.iban} label={captain.iban} className="font-mono" />
                            ) : '-'}
                            {captain?.bank_name && (
                              <span className="block text-muted-foreground pl-1.5">
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
                    <SortableHeader column="processed_at" label="Date Processed" />
                    <SortableHeader column="captain" label="Captain" />
                    <SortableHeader column="trip" label="Trip" />
                    <SortableHeader column="payout_amount" label="Amount" className="text-right" />
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
                        <TableCell>
                          <Link href={`/captains/${payout.captain_id}`} className="hover:underline">
                            {captain?.display_name ?? 'Unknown'}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link href={`/trips/${payout.trip_id}`} className="hover:underline">
                            {trip?.title ?? 'Unknown'}
                          </Link>
                        </TableCell>
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
