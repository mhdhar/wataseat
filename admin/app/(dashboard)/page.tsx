import Link from 'next/link';
import { getDashboardKPIs, getRecentActivity, getAlerts } from '@/lib/queries';
import { KPICard } from '@/components/kpi-card';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

function formatAED(amount: number): string {
  return `${amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const activityBadgeVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  booking: 'default',
  trip: 'secondary',
  captain: 'outline',
};

export default async function DashboardPage() {
  const [kpis, activity, alerts] = await Promise.all([
    getDashboardKPIs(),
    getRecentActivity(),
    getAlerts(),
  ]);

  const totalAlerts =
    alerts.atRiskTrips.length +
    alerts.stalePayouts.length +
    alerts.stuckCaptains.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Overview of your WataSeat platform.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Revenue (30d)"
          value={formatAED(kpis.totalRevenue)}
          change={kpis.revenueChange}
        />
        <KPICard
          title="Platform Commission (30d)"
          value={formatAED(kpis.platformCommission)}
          subtitle="10% of revenue"
        />
        <KPICard
          title="Active Trips"
          value={String(kpis.activeTrips)}
          subtitle="Currently open for booking"
        />
        <KPICard
          title="Pending Payouts"
          value={String(kpis.pendingPayouts)}
          subtitle={
            kpis.pendingPayoutAmount > 0
              ? formatAED(kpis.pendingPayoutAmount)
              : 'No pending payouts'
          }
        />
      </div>

      {/* Alerts + Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Alerts
              {totalAlerts > 0 && (
                <Badge variant="destructive">{totalAlerts}</Badge>
              )}
            </CardTitle>
            <CardDescription>Items that need your attention</CardDescription>
          </CardHeader>
          <CardContent>
            {totalAlerts === 0 ? (
              <p className="text-sm text-muted-foreground">
                No alerts right now. Everything looks good.
              </p>
            ) : (
              <div className="space-y-4">
                {alerts.atRiskTrips.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">
                      At-Risk Trips ({alerts.atRiskTrips.length})
                    </h3>
                    <ul className="space-y-2">
                      {alerts.atRiskTrips.map((trip) => (
                        <li key={trip.id}>
                          <Link
                            href={`/trips/${trip.id}`}
                            className="block rounded-md border p-3 text-sm hover:bg-muted/50 transition-colors"
                          >
                            <span className="font-medium">{trip.title}</span>
                            <span className="text-muted-foreground ml-2">
                              {trip.current_bookings}/{trip.threshold} seats
                              filled
                            </span>
                            <span className="text-muted-foreground text-xs block mt-1">
                              Departs{' '}
                              {new Date(trip.departure_at).toLocaleString()}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {alerts.stalePayouts.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">
                      Stale Payouts ({alerts.stalePayouts.length})
                    </h3>
                    <ul className="space-y-2">
                      {alerts.stalePayouts.map((payout) => (
                        <li key={payout.id}>
                          <Link
                            href="/payouts"
                            className="block rounded-md border p-3 text-sm hover:bg-muted/50 transition-colors"
                          >
                            <span className="font-medium">
                              {formatAED(payout.payout_amount)}
                            </span>
                            <span className="text-muted-foreground ml-2">
                              pending since{' '}
                              {new Date(payout.created_at).toLocaleDateString()}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {alerts.stuckCaptains.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">
                      Incomplete Onboarding ({alerts.stuckCaptains.length})
                    </h3>
                    <ul className="space-y-2">
                      {alerts.stuckCaptains.map((captain) => (
                        <li key={captain.id}>
                          <Link
                            href={`/captains/${captain.id}`}
                            className="block rounded-md border p-3 text-sm hover:bg-muted/50 transition-colors"
                          >
                            <span className="font-medium">
                              {captain.display_name}
                            </span>
                            <Badge variant="outline" className="ml-2">
                              {captain.onboarding_step}
                            </Badge>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest events across the platform</CardDescription>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No activity yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {activity.map((item) => (
                  <li
                    key={`${item.type}-${item.id}`}
                    className="flex items-start gap-3 text-sm"
                  >
                    <Badge variant={activityBadgeVariant[item.type]}>
                      {item.type}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{item.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {timeAgo(item.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
