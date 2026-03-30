import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTripDetail } from '@/lib/queries';
import {
  Card,
  CardContent,
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
import { DeleteTripButton } from './cancel-trip-button';

export const dynamic = 'force-dynamic';

function formatAED(amount: number | string): string {
  return `${Number(amount).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-AE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const statusStyles: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  completed: 'bg-gray-100 text-gray-800',
  authorized: 'bg-yellow-100 text-yellow-800',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={statusStyles[status] || ''}>
      {status}
    </Badge>
  );
}

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { trip, bookings, payout } = await getTripDetail(id);

  if (!trip) {
    notFound();
  }

  const captain = trip.captains as { display_name: string; whatsapp_id: string } | null;
  const shortId = trip.id?.slice(0, 6) ?? '';

  // Financial calculations
  const activeBookings = bookings.filter((b) =>
    ['authorized', 'confirmed'].includes(b.status)
  );
  const totalCollected = activeBookings.reduce(
    (sum, b) => sum + Number(b.total_amount_aed ?? 0),
    0
  );
  const commission = activeBookings.reduce(
    (sum, b) => sum + Number(b.platform_fee_aed ?? 0),
    0
  );
  const captainPayoutTotal = activeBookings.reduce(
    (sum, b) => sum + Number(b.captain_payout_aed ?? 0),
    0
  );

  // Fill rate
  const currentBookings = trip.current_bookings ?? 0;
  const maxSeats = trip.max_seats ?? 0;
  const threshold = trip.threshold ?? 0;
  const fillPercent = maxSeats > 0 ? Math.round((currentBookings / maxSeats) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link href="/trips" className="hover:underline">
              Trips
            </Link>
            <span>/</span>
            <span>{trip.title || trip.trip_type}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            {trip.title || trip.trip_type}
            <StatusBadge status={trip.status} />
            <span className="text-sm font-mono text-muted-foreground font-normal">
              #{shortId}
            </span>
          </h1>
        </div>
        {trip.status !== 'cancelled' && <DeleteTripButton tripId={trip.id} />}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Trip Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>Trip Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Type</span>
              <p className="font-medium capitalize">{trip.trip_type || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Title</span>
              <p className="font-medium">{trip.title || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Departure</span>
              <p className="font-medium">
                {trip.departure_at ? formatDate(trip.departure_at) : '-'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Duration</span>
              <p className="font-medium">
                {trip.duration_hours ? `${trip.duration_hours} hours` : '-'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Meeting Point</span>
              <p className="font-medium">{trip.meeting_point || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Price</span>
              <p className="font-medium">
                {formatAED(trip.price_per_person_aed ?? 0)}/person
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Captain</span>
              <p className="font-medium">{captain?.display_name || '-'}</p>
              {captain?.whatsapp_id && (
                <p className="text-xs text-muted-foreground font-mono">
                  {captain.whatsapp_id}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fill Rate Card */}
        <Card>
          <CardHeader>
            <CardTitle>Fill Rate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center">
              <p className="text-3xl font-bold">
                {currentBookings}/{maxSeats}
              </p>
              <p className="text-sm text-muted-foreground">seats booked</p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${
                  currentBookings >= threshold
                    ? 'bg-green-500'
                    : 'bg-yellow-500'
                }`}
                style={{ width: `${Math.min(fillPercent, 100)}%` }}
              />
            </div>
            <p className="text-sm text-center text-muted-foreground">
              {currentBookings >= threshold ? (
                <span className="text-green-600 font-medium">
                  Threshold met!
                </span>
              ) : (
                <>
                  Need <span className="font-medium">{threshold}</span> min
                  &mdash; {threshold - currentBookings} more needed
                </>
              )}
            </p>
            <div className="grid grid-cols-2 gap-4 text-sm pt-2">
              <div>
                <span className="text-muted-foreground">Max Seats</span>
                <p className="font-medium">{maxSeats}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Threshold</span>
                <p className="font-medium">{threshold}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Financial Summary Card */}
        <Card>
          <CardHeader>
            <CardTitle>Financial Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="text-muted-foreground">Total Collected</span>
              <p className="text-2xl font-bold">{formatAED(totalCollected)}</p>
              <p className="text-xs text-muted-foreground">
                from {activeBookings.length} active booking(s)
              </p>
            </div>
            <Separator />
            <div>
              <span className="text-muted-foreground">
                Platform Commission (10%)
              </span>
              <p className="font-medium">{formatAED(commission)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Captain Payout</span>
              <p className="font-medium">{formatAED(captainPayoutTotal)}</p>
            </div>
            <Separator />
            <div>
              <span className="text-muted-foreground">Payout Status</span>
              {payout ? (
                <p>
                  <StatusBadge status={payout.status} />
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Not yet created</p>
              )}
            </div>
            {payout?.processed_at && (
              <div>
                <span className="text-muted-foreground">Processed At</span>
                <p className="font-medium">
                  {formatDate(payout.processed_at)}
                </p>
              </div>
            )}
            {payout?.status === 'completed' && payout.bank_reference && (
              <div>
                <span className="text-muted-foreground">Bank Reference</span>
                <p className="font-mono text-xs font-medium">{payout.bank_reference}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Guest List Table */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Guest List ({bookings.length})
        </h2>
        {bookings.length === 0 ? (
          <div className="rounded-md border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No bookings for this trip yet.
            </p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Booked At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-medium">
                      {booking.guest_name || 'Guest'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {booking.guest_whatsapp_id}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={booking.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {formatAED(booking.total_amount_aed ?? 0)}
                    </TableCell>
                    <TableCell>
                      {booking.created_at
                        ? formatDate(booking.created_at)
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Per-Guest Financial Breakdown */}
      {bookings.length > 0 && (
        <>
          <Separator />
          <div>
            <h2 className="text-lg font-semibold mb-4">
              Per-Guest Financial Breakdown
            </h2>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Platform Fee</TableHead>
                    <TableHead className="text-right">Captain Payout</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((booking) => {
                    const bookingStatusStyles: Record<string, string> = {
                      authorized: 'bg-blue-100 text-blue-800',
                      confirmed: 'bg-green-100 text-green-800',
                      cancelled: 'bg-red-100 text-red-800',
                      refunded: 'bg-gray-100 text-gray-800',
                    };
                    return (
                      <TableRow key={booking.id}>
                        <TableCell className="font-medium">
                          {booking.guest_name || 'Guest'}
                        </TableCell>
                        <TableCell>
                          {formatAED(booking.total_amount_aed ?? 0)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={bookingStatusStyles[booking.status] || ''}
                          >
                            {booking.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatAED(booking.platform_fee_aed ?? 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatAED(booking.captain_payout_aed ?? 0)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
