'use client';

import { useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import type { CalendarTrip } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';

type View = 'month' | 'week' | 'day';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 border-blue-200',
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200 line-through opacity-60',
  completed: 'bg-gray-100 text-gray-600 border-gray-200',
};

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  completed: 'bg-gray-100 text-gray-800',
};

const TYPE_ICONS: Record<string, string> = {
  fishing: '🎣',
  diving: '🤿',
  cruising: '🚢',
  other: '🚤',
};

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-AE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

interface TripCalendarProps {
  trips: CalendarTrip[];
  currentDate: string;
  view: View;
}

export function TripCalendar({ trips, currentDate, view }: TripCalendarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedTrip, setSelectedTrip] = useState<CalendarTrip | null>(null);

  const date = new Date(currentDate + 'T00:00:00');
  const today = new Date();

  function navigate(newDate: Date, newView?: View) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('date', newDate.toISOString().slice(0, 10));
    if (newView) params.set('view', newView);
    router.push(`${pathname}?${params.toString()}`);
  }

  function setView(v: View) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', v);
    router.push(`${pathname}?${params.toString()}`);
  }

  function prev() {
    const d = new Date(date);
    if (view === 'month') d.setMonth(d.getMonth() - 1);
    else if (view === 'week') d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    navigate(d);
  }

  function next() {
    const d = new Date(date);
    if (view === 'month') d.setMonth(d.getMonth() + 1);
    else if (view === 'week') d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    navigate(d);
  }

  function goToday() {
    navigate(new Date());
  }

  function openTrip(id: string) {
    const trip = trips.find((t) => t.id === id);
    if (trip) setSelectedTrip(trip);
  }

  const title = view === 'month'
    ? date.toLocaleDateString('en-AE', { month: 'long', year: 'numeric' })
    : view === 'week'
      ? (() => {
          const start = new Date(date);
          start.setDate(start.getDate() - start.getDay());
          const end = new Date(start);
          end.setDate(end.getDate() + 6);
          return `${start.toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
        })()
      : date.toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="relative">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={prev} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">←</button>
            <button onClick={goToday} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Today</button>
            <button onClick={next} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">→</button>
            <h2 className="text-lg font-semibold ml-3">{title}</h2>
          </div>
          <div className="flex rounded-md border overflow-hidden">
            {(['month', 'week', 'day'] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm capitalize ${view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Calendar Grid */}
        {view === 'month' && <MonthView date={date} today={today} trips={trips} onTripClick={openTrip} onDayClick={(d) => navigate(d, 'day')} />}
        {view === 'week' && <WeekView date={date} today={today} trips={trips} onTripClick={openTrip} />}
        {view === 'day' && <DayView date={date} today={today} trips={trips} onTripClick={openTrip} />}
      </div>

      {/* Slide-over panel */}
      {selectedTrip && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setSelectedTrip(null)} />
          {/* Panel */}
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-xl z-50 overflow-y-auto border-l">
            <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between z-10">
              <h3 className="font-semibold text-lg">Trip Details</h3>
              <button
                onClick={() => setSelectedTrip(null)}
                className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
              >
                ✕ Close
              </button>
            </div>
            <TripPanel trip={selectedTrip} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Trip Detail Panel ──────────────────────────────────

function formatAED(n: number): string {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function TripPanel({ trip }: { trip: CalendarTrip }) {
  const fillPct = trip.max_seats > 0 ? Math.min((trip.current_bookings / trip.max_seats) * 100, 100) : 0;
  const tripEnded = new Date(trip.departure_at).getTime() + (trip.duration_hours || 4) * 3600000 < Date.now();
  const isFinished = trip.status === 'completed' || trip.status === 'confirmed' && tripEnded;

  return (
    <div className="p-5 space-y-5">
      {/* Title + Status */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">{TYPE_ICONS[trip.trip_type] || '🚤'}</span>
          <h2 className="text-xl font-bold">{trip.title}</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className={STATUS_BADGE[trip.status] || ''}>
            {trip.status}
          </Badge>
          {isFinished && trip.status !== 'completed' && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-800">Trip ended</Badge>
          )}
          <span className="text-xs text-muted-foreground font-mono">#{trip.id.slice(0, 6)}</span>
        </div>
      </div>

      {/* Trip Info */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Date & Time</span>
          <span className="font-medium">{formatFullDate(trip.departure_at)}</span>
        </div>
        {trip.duration_hours && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Duration</span>
            <span className="font-medium">{trip.duration_hours} hours</span>
          </div>
        )}
        {trip.meeting_point && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Meeting Point</span>
            <span className="font-medium">{trip.meeting_point}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Captain</span>
          <Link href={`/captains/${trip.captain_id}`} className="font-medium text-blue-600 hover:underline">
            {trip.captain_name}
          </Link>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Price</span>
          <span className="font-medium">{formatAED(trip.price_per_person_aed)}/person</span>
        </div>
      </div>

      {/* Bookings */}
      <div className="rounded-lg border p-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-muted-foreground">Bookings</span>
          <span className="font-medium">{trip.current_bookings} / {trip.max_seats} seats</span>
        </div>
        <div className="relative h-3 rounded-full bg-gray-200 overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all ${trip.current_bookings >= trip.max_seats ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
      </div>

      {/* Financials — show if there's revenue */}
      {trip.total_revenue > 0 && (
        <div className="rounded-lg border p-4 space-y-3">
          <h4 className="text-sm font-semibold">Financials</h4>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total Revenue</span>
            <span className="font-medium">{formatAED(trip.total_revenue)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Platform Commission</span>
            <span className="font-medium text-green-700">{formatAED(trip.total_commission)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Captain Payout</span>
            <span className="font-bold">{formatAED(trip.total_captain_payout)}</span>
          </div>
        </div>
      )}

      {/* Payout Status */}
      {(isFinished || trip.payout) && (
        <div className={`rounded-lg border p-4 space-y-3 ${!trip.payout && isFinished ? 'border-amber-300 bg-amber-50' : trip.payout?.status === 'pending' ? 'border-amber-300 bg-amber-50' : trip.payout?.status === 'completed' ? 'border-green-300 bg-green-50' : ''}`}>
          <h4 className="text-sm font-semibold flex items-center gap-2">
            Payout
            {!trip.payout && isFinished && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">Not created yet</Badge>
            )}
            {trip.payout?.status === 'pending' && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">Awaiting payment</Badge>
            )}
            {trip.payout?.status === 'completed' && (
              <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs">Paid</Badge>
            )}
          </h4>

          {trip.payout && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-bold">{formatAED(trip.payout.payout_amount)}</span>
              </div>
              {trip.payout.bank_reference && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Bank Reference</span>
                  <span className="font-mono text-xs">{trip.payout.bank_reference}</span>
                </div>
              )}
              {trip.payout.processed_at && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Processed</span>
                  <span className="text-xs">{new Date(trip.payout.processed_at).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
              )}
            </>
          )}

          {/* Quick link to payouts page */}
          {trip.payout?.status === 'pending' && (
            <Link
              href="/payouts"
              className="block w-full text-center rounded-md bg-amber-600 text-white px-4 py-2 text-sm font-medium hover:bg-amber-700 mt-2"
            >
              Go to Payouts → Mark as Paid
            </Link>
          )}
          {!trip.payout && isFinished && (
            <p className="text-xs text-amber-700">
              Payout will be created automatically once the cron job runs after the trip ends.
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="pt-2 border-t space-y-2">
        <Link
          href={`/trips/${trip.id}`}
          className="block w-full text-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
        >
          Open Full Trip Page →
        </Link>
        {trip.payout?.status === 'pending' && (
          <Link
            href="/payouts"
            className="block w-full text-center rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Go to Payouts Queue
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Month View ──────────────────────────────────────────

function MonthView({ date, today, trips, onTripClick, onDayClick }: {
  date: Date; today: Date; trips: CalendarTrip[];
  onTripClick: (id: string) => void; onDayClick: (d: Date) => void;
}) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();

  const days: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(null);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-muted/50">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="px-2 py-2 text-xs font-medium text-muted-foreground text-center border-b">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const dayTrips = day ? trips.filter((t) => isSameDay(new Date(t.departure_at), day)) : [];
          const isToday = day && isSameDay(day, today);
          return (
            <div
              key={i}
              className={`min-h-[100px] border-b border-r p-1 ${day ? 'cursor-pointer hover:bg-muted/30' : 'bg-muted/10'} ${isToday ? 'bg-blue-50' : ''}`}
              onClick={() => day && onDayClick(day)}
            >
              {day && (
                <>
                  <div className={`text-xs font-medium mb-1 px-1 ${isToday ? 'bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center' : 'text-muted-foreground'}`}>
                    {day.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayTrips.slice(0, 3).map((trip) => (
                      <button
                        key={trip.id}
                        onClick={(e) => { e.stopPropagation(); onTripClick(trip.id); }}
                        className={`w-full text-left text-[10px] leading-tight rounded px-1 py-0.5 border truncate ${STATUS_COLORS[trip.status] || 'bg-gray-100'}`}
                        title={`${trip.title} — ${trip.captain_name} — ${formatTime(trip.departure_at)}`}
                      >
                        {formatTime(trip.departure_at)} {TYPE_ICONS[trip.trip_type] || ''} {trip.title}
                      </button>
                    ))}
                    {dayTrips.length > 3 && (
                      <div className="text-[10px] text-muted-foreground px-1">+{dayTrips.length - 3} more</div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Week View ──────────────────────────────────────────

function WeekView({ date, today, trips, onTripClick }: {
  date: Date; today: Date; trips: CalendarTrip[]; onTripClick: (id: string) => void;
}) {
  const weekStart = new Date(date);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const weekDays: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    weekDays.push(d);
  }

  const hours = Array.from({ length: 17 }, (_, i) => i + 5);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="grid grid-cols-[60px_repeat(7,1fr)] bg-muted/50 border-b">
        <div className="px-2 py-2 text-xs font-medium text-muted-foreground" />
        {weekDays.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <div key={i} className={`px-2 py-2 text-center border-l ${isToday ? 'bg-blue-50' : ''}`}>
              <div className="text-xs text-muted-foreground">{d.toLocaleDateString('en-AE', { weekday: 'short' })}</div>
              <div className={`text-sm font-medium ${isToday ? 'bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center mx-auto' : ''}`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[60px_repeat(7,1fr)] max-h-[600px] overflow-y-auto">
        {hours.map((hour) => (
          <div key={hour} className="contents">
            <div className="px-2 py-3 text-xs text-muted-foreground text-right border-b">
              {hour.toString().padStart(2, '0')}:00
            </div>
            {weekDays.map((day, di) => {
              const cellTrips = trips.filter((t) => {
                const td = new Date(t.departure_at);
                return isSameDay(td, day) && td.getHours() === hour;
              });
              return (
                <div key={di} className="border-l border-b min-h-[48px] p-0.5 relative">
                  {cellTrips.map((trip) => (
                    <button
                      key={trip.id}
                      onClick={() => onTripClick(trip.id)}
                      className={`w-full text-left text-[11px] leading-tight rounded px-1.5 py-1 border mb-0.5 ${STATUS_COLORS[trip.status] || 'bg-gray-100'}`}
                    >
                      <div className="font-medium truncate">{TYPE_ICONS[trip.trip_type] || ''} {trip.title}</div>
                      <div className="text-[10px] opacity-75 truncate">{trip.captain_name} · {trip.current_bookings}/{trip.max_seats}</div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Day View ──────────────────────────────────────────

function DayView({ date, today, trips, onTripClick }: {
  date: Date; today: Date; trips: CalendarTrip[]; onTripClick: (id: string) => void;
}) {
  const dayTrips = trips.filter((t) => isSameDay(new Date(t.departure_at), date));
  const hours = Array.from({ length: 17 }, (_, i) => i + 5);
  const isToday = isSameDay(date, today);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className={`px-4 py-3 border-b text-sm font-medium ${isToday ? 'bg-blue-50' : 'bg-muted/50'}`}>
        {date.toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long' })}
        {isToday && <span className="ml-2 text-xs bg-blue-600 text-white rounded-full px-2 py-0.5">Today</span>}
        <span className="ml-3 text-muted-foreground">{dayTrips.length} trip{dayTrips.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        {hours.map((hour) => {
          const hourTrips = dayTrips.filter((t) => new Date(t.departure_at).getHours() === hour);
          return (
            <div key={hour} className="flex border-b min-h-[56px]">
              <div className="w-16 shrink-0 px-2 py-2 text-xs text-muted-foreground text-right border-r">
                {hour.toString().padStart(2, '0')}:00
              </div>
              <div className="flex-1 p-1 space-y-1">
                {hourTrips.map((trip) => (
                  <button
                    key={trip.id}
                    onClick={() => onTripClick(trip.id)}
                    className={`w-full text-left rounded-md px-3 py-2 border ${STATUS_COLORS[trip.status] || 'bg-gray-100'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">
                        {TYPE_ICONS[trip.trip_type] || ''} {trip.title}
                      </div>
                      <Badge variant="secondary" className={STATUS_BADGE[trip.status] || ''}>{trip.status}</Badge>
                    </div>
                    <div className="text-xs mt-1 opacity-75">
                      {formatTime(trip.departure_at)}
                      {trip.duration_hours ? ` · ${trip.duration_hours}h` : ''}
                      {' · '}{trip.captain_name}
                      {' · '}{trip.current_bookings}/{trip.max_seats} seats
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
