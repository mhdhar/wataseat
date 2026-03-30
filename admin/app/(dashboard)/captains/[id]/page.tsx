import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCaptainDetail } from '@/lib/queries';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { BankDetailsForm } from './bank-details-form';
import { SuspendButton } from './suspend-button';

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

function getStatusBadge(captain: {
  is_suspended?: boolean;
  onboarding_step?: string;
}) {
  if (captain.is_suspended) {
    return <Badge variant="destructive">Suspended</Badge>;
  }
  if (captain.onboarding_step !== 'complete') {
    return (
      <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
        Onboarding
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-green-100 text-green-800">
      Active
    </Badge>
  );
}

export default async function CaptainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { captain, trips, payouts } = await getCaptainDetail(id);

  if (!captain) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link href="/captains" className="hover:underline">
              Captains
            </Link>
            <span>/</span>
            <span>{captain.display_name || 'Unnamed'}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            {captain.display_name || 'Unnamed Captain'}
            {getStatusBadge(captain)}
          </h1>
        </div>
        <SuspendButton
          captainId={captain.id}
          isSuspended={!!captain.is_suspended}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Name</span>
              <p className="font-medium">{captain.display_name || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Boat Name</span>
              <p className="font-medium">{captain.boat_name || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">License Number</span>
              <p className="font-medium">{captain.license_number || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">WhatsApp ID</span>
              <p className="font-mono text-xs">{captain.whatsapp_id}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Onboarding Step</span>
              <p>
                <Badge variant="outline">{captain.onboarding_step}</Badge>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Bank Details Card */}
        <Card>
          <CardHeader>
            <CardTitle>Bank Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">IBAN</span>
              <p className="font-mono text-xs font-medium">
                {captain.iban || 'Not provided'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Bank Name</span>
              <p className="font-medium">{captain.bank_name || 'Not provided'}</p>
            </div>
            <Separator />
            <BankDetailsForm
              captainId={captain.id}
              initialIban={captain.iban || ''}
              initialBankName={captain.bank_name || ''}
            />
          </CardContent>
        </Card>

        {/* Lifetime Stats Card */}
        <Card>
          <CardHeader>
            <CardTitle>Lifetime Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Total Trips</span>
              <p className="text-2xl font-bold">{captain.total_trips ?? 0}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Total Revenue</span>
              <p className="text-2xl font-bold">
                {formatAED(captain.total_revenue_aed ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bank Details Card */}
      <Card>
        <CardHeader>
          <CardTitle>Bank Details</CardTitle>
          <CardDescription>
            Used for manual bank transfer payouts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BankDetailsForm
            captainId={captain.id}
            initialBankName={captain.bank_name || ''}
            initialIban={captain.iban || ''}
          />
        </CardContent>
      </Card>

      <Separator />

      {/* Trip History Table */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Trip History</h2>
        {trips.length === 0 ? (
          <div className="rounded-md border p-8 text-center">
            <p className="text-sm text-muted-foreground">No trips yet.</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trips.map((trip) => (
                  <TableRow key={trip.id}>
                    <TableCell className="font-medium">
                      <Link href={`/trips/${trip.id}`} className="hover:underline">{trip.title}</Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{trip.trip_type}</Badge>
                    </TableCell>
                    <TableCell>
                      {trip.departure_at ? formatDate(trip.departure_at) : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          trip.status === 'open'
                            ? 'default'
                            : trip.status === 'completed'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {trip.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {trip.current_bookings ?? 0}/{trip.max_seats ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Payout History Table */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Payout History</h2>
        {payouts.length === 0 ? (
          <div className="rounded-md border p-8 text-center">
            <p className="text-sm text-muted-foreground">No payouts yet.</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trip</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((payout) => {
                  const trip = payout.trips as { title: string } | null;
                  return (
                    <TableRow key={payout.id}>
                      <TableCell className="font-medium">
                        <Link href={`/trips/${payout.trip_id}`} className="hover:underline">
                          {trip?.title ?? 'Unknown'}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatAED(payout.payout_amount)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            payout.status === 'completed'
                              ? 'default'
                              : payout.status === 'pending'
                                ? 'secondary'
                                : 'outline'
                          }
                        >
                          {payout.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {payout.processed_at
                          ? formatDate(payout.processed_at)
                          : payout.created_at
                            ? formatDate(payout.created_at)
                            : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
