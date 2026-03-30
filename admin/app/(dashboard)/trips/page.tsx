import Link from 'next/link';
import { getTrips } from '@/lib/queries';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DeleteTripButton } from './[id]/cancel-trip-button';
import { BookButton } from './book-button';
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
    hour: '2-digit',
    minute: '2-digit',
  });
}

const statusStyles: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  completed: 'bg-gray-100 text-gray-800',
};

function TripStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={statusStyles[status] || ''}>
      {status}
    </Badge>
  );
}

const typeIcons: Record<string, string> = {
  fishing: '🎣',
  diving: '🤿',
  cruise: '🚢',
  island: '🏝️',
};

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; sort?: string; order?: string }>;
}) {
  const params = await searchParams;
  const status = params.status || '';
  const search = params.search || '';
  const sort = params.sort || null;
  const order = params.order || null;
  const rawTrips = await getTrips({
    status: status || undefined,
    search: search || undefined,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trips = sortData(rawTrips, sort, order, (item: any, key: string) => {
    if (key === 'captain') return item.captains?.display_name;
    if (key === 'price') return Number(item.price_per_person_aed);
    if (key === 'date') return item.departure_at;
    if (key === 'bookings') return item.paid_bookings ?? item.current_bookings ?? 0;
    return item[key];
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Trips</h1>
        <p className="text-muted-foreground mt-1">
          View and manage all trips across the platform.
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
            className="flex h-8 w-40 items-center rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="search" className="text-xs font-medium text-muted-foreground">
            Search
          </label>
          <Input
            id="search"
            name="search"
            placeholder="Search by title..."
            defaultValue={search}
            className="w-60"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
        >
          Filter
        </button>
        {(status || search) && (
          <Link
            href="/trips"
            className="inline-flex h-8 items-center rounded-lg border border-input px-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            Clear
          </Link>
        )}
      </form>

      {trips.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {status || search ? 'No trips match your filters.' : 'No trips yet.'}
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader column="title" label="Trip" />
                <SortableHeader column="captain" label="Captain" />
                <SortableHeader column="date" label="Date" />
                <SortableHeader column="status" label="Status" />
                <SortableHeader column="bookings" label="Bookings" />
                <SortableHeader column="price" label="Price" className="text-right" />
                <SortableHeader column="" label="Book" className="text-center" />
                <SortableHeader column="" label="Action" className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {trips.map((trip) => {
                const captain = trip.captains as { display_name: string } | null;
                const shortId = trip.id?.slice(0, 6) ?? '';
                const icon = typeIcons[trip.trip_type] || '';
                return (
                  <TableRow key={trip.id}>
                    <TableCell>
                      <Link
                        href={`/trips/${trip.id}`}
                        className="font-medium hover:underline"
                      >
                        {icon ? `${icon} ` : ''}{trip.title || trip.trip_type}
                      </Link>
                      <span className="block text-xs text-muted-foreground font-mono">
                        #{shortId}
                      </span>
                    </TableCell>
                    <TableCell>
                      {captain?.display_name ? (
                        <Link href={`/captains/${trip.captain_id}`} className="hover:underline">
                          {captain.display_name}
                        </Link>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {trip.departure_at ? formatDate(trip.departure_at) : '-'}
                    </TableCell>
                    <TableCell>
                      <TripStatusBadge status={trip.status} />
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const booked = trip.paid_bookings ?? trip.current_bookings ?? 0;
                        const pending = trip.pending_bookings ?? 0;
                        const max = trip.max_seats ?? 0;
                        const threshold = trip.threshold ?? 0;
                        const thresholdPct = max > 0 ? Math.min((threshold / max) * 100, 100) : 0;
                        const fillPct = max > 0 ? Math.min((booked / max) * 100, 100) : 0;
                        const thresholdMet = booked >= threshold;
                        const remaining = Math.max(threshold - booked, 0);
                        return (
                          <div className="min-w-[160px]">
                            <div className="flex justify-between text-sm mb-1">
                              <span className="font-medium">{booked}/{max} seats</span>
                              {thresholdMet ? (
                                <span className="text-green-600 text-xs font-medium">Threshold met</span>
                              ) : (
                                <span className="text-amber-600 text-xs">need {remaining} more</span>
                              )}
                            </div>
                            <div className="relative h-2 rounded-full bg-gray-200 overflow-hidden">
                              <div
                                className={`absolute inset-y-0 left-0 rounded-full transition-all ${thresholdMet ? 'bg-green-500' : 'bg-blue-500'}`}
                                style={{ width: `${fillPct}%` }}
                              />
                              <div
                                className="absolute inset-y-0 w-0.5 bg-gray-800"
                                style={{ left: `${thresholdPct}%` }}
                                title={`Threshold: ${threshold}`}
                              />
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              min {threshold} to confirm{pending > 0 ? ` · ${pending} awaiting payment` : ''}
                            </div>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatAED(trip.price_per_person_aed ?? 0)}/person
                    </TableCell>
                    <TableCell className="text-center">
                      {trip.status === 'open' && (
                        <BookButton tripId={trip.id} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {trip.status !== 'cancelled' && (
                        <DeleteTripButton tripId={trip.id} />
                      )}
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
