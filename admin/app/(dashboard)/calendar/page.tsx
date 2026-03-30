import { getTripsForCalendar } from '@/lib/queries';
import { TripCalendar } from '@/components/trip-calendar';

export const dynamic = 'force-dynamic';

type View = 'month' | 'week' | 'day';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const params = await searchParams;
  const view = (['month', 'week', 'day'].includes(params.view || '') ? params.view : 'month') as View;
  const dateStr = params.date || new Date().toISOString().slice(0, 10);
  const date = new Date(dateStr + 'T00:00:00');

  // Calculate visible range based on view
  let from: Date;
  let to: Date;

  if (view === 'month') {
    from = new Date(date.getFullYear(), date.getMonth(), 1);
    to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
  } else if (view === 'week') {
    from = new Date(date);
    from.setDate(from.getDate() - from.getDay());
    to = new Date(from);
    to.setDate(to.getDate() + 6);
    to.setHours(23, 59, 59);
  } else {
    from = new Date(date);
    to = new Date(date);
    to.setHours(23, 59, 59);
  }

  const trips = await getTripsForCalendar(from.toISOString(), to.toISOString());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
        <p className="text-muted-foreground mt-1">
          View all scheduled trips on a calendar.
        </p>
      </div>
      <TripCalendar trips={trips} currentDate={dateStr} view={view} />
    </div>
  );
}
