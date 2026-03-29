import Link from 'next/link';
import { getRevenueData, getFinancialSummary, type Granularity } from '@/lib/finance-queries';
import { KPICard } from '@/components/kpi-card';
import { RevenueChart } from '@/components/revenue-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

function formatAED(amount: number): string {
  return `${amount.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED`;
}

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{ granularity?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const granularity: Granularity =
    params.granularity === 'daily' || params.granularity === 'weekly' || params.granularity === 'monthly'
      ? params.granularity
      : 'monthly';

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(now.getDate() - 30);

  const from = params.from || defaultFrom.toISOString().slice(0, 10);
  const to = params.to || now.toISOString().slice(0, 10);

  const [revenueData, summary] = await Promise.all([
    getRevenueData(granularity, from, to),
    getFinancialSummary(from, to),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finances</h1>
          <p className="text-muted-foreground mt-1">
            Revenue breakdown and financial overview.
          </p>
        </div>
        <Link
          href={`/finances/export?from=${from}&to=${to}`}
          className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          Export CSV
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard
          title="Total Revenue"
          value={formatAED(summary.totalRevenue)}
          subtitle={`${summary.bookingCount} bookings`}
        />
        <KPICard
          title="Platform Commission"
          value={formatAED(summary.totalCommission)}
          subtitle="10% of revenue"
        />
        <KPICard
          title="Captain Payouts"
          value={formatAED(summary.totalPayouts)}
          subtitle="90% of revenue"
        />
      </div>

      {/* Chart Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Revenue Over Time</CardTitle>
            <div className="flex gap-1">
              {GRANULARITY_OPTIONS.map((opt) => (
                <Link
                  key={opt.value}
                  href={`/finances?granularity=${opt.value}&from=${from}&to=${to}`}
                  className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                    granularity === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  {opt.label}
                </Link>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <RevenueChart data={revenueData} />
        </CardContent>
      </Card>
    </div>
  );
}
