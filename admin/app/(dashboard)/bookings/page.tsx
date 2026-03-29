import Link from 'next/link';
import { getBookings } from '@/lib/queries';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RefundButton } from './refund-button';

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
  pending_payment: 'bg-yellow-100 text-yellow-800',
  authorized: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-gray-100 text-gray-800',
};

const statusLabels: Record<string, string> = {
  pending_payment: 'Pending Payment',
  authorized: 'Authorized',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

function BookingStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={statusStyles[status] || ''}>
      {statusLabels[status] || status}
    </Badge>
  );
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; trip_id?: string }>;
}) {
  const params = await searchParams;
  const status = params.status || '';
  const tripId = params.trip_id || '';
  const bookings = await getBookings({
    status: status || undefined,
    trip_id: tripId || undefined,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
        <p className="text-muted-foreground mt-1">
          View and manage all guest bookings across the platform.
        </p>
      </div>

      <form method="GET" className="flex items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="status" className="text-xs font-medium text-muted-foreground">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="flex h-8 w-48 items-center rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">All</option>
            <option value="pending_payment">Pending Payment</option>
            <option value="authorized">Authorized</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
        >
          Filter
        </button>
        {status && (
          <Link
            href="/bookings"
            className="inline-flex h-8 items-center rounded-lg border border-input px-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            Clear
          </Link>
        )}
      </form>

      {bookings.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {status ? 'No bookings match your filters.' : 'No bookings yet.'}
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>WhatsApp ID</TableHead>
                <TableHead>Trip</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Booked at</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((booking) => {
                const trip = booking.trips as { title: string; trip_type: string } | null;
                const canRefund = booking.status === 'authorized' || booking.status === 'confirmed';
                return (
                  <TableRow key={booking.id}>
                    <TableCell className="font-medium">
                      {booking.guest_name || 'Guest'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {booking.guest_whatsapp_id || '-'}
                    </TableCell>
                    <TableCell>
                      {booking.trip_id ? (
                        <Link
                          href={`/trips/${booking.trip_id}`}
                          className="hover:underline"
                        >
                          {trip?.title || trip?.trip_type || 'View trip'}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <BookingStatusBadge status={booking.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {formatAED(booking.total_amount_aed ?? 0)}
                    </TableCell>
                    <TableCell>
                      {booking.created_at ? formatDate(booking.created_at) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {canRefund ? (
                        <RefundButton
                          bookingId={booking.id}
                          guestName={booking.guest_name || 'Guest'}
                          amount={formatAED(booking.total_amount_aed ?? 0)}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
