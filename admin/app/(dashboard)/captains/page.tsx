import Link from 'next/link';
import { getCaptains } from '@/lib/queries';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export const dynamic = 'force-dynamic';

function formatAED(amount: number | string): string {
  return `${Number(amount).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED`;
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

export default async function CaptainsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const params = await searchParams;
  const search = params.search || '';
  const captains = await getCaptains(search || undefined);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Captains</h1>
        <p className="text-muted-foreground mt-1">
          Manage captain accounts and onboarding.
        </p>
      </div>

      <form method="GET" className="max-w-sm">
        <Input
          name="search"
          placeholder="Search by name or phone..."
          defaultValue={search}
        />
      </form>

      {captains.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {search ? 'No captains match your search.' : 'No captains yet.'}
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Boat</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Trips</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead>Stripe Connect</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {captains.map((captain) => (
                <TableRow key={captain.id}>
                  <TableCell>
                    <Link
                      href={`/captains/${captain.id}`}
                      className="font-medium hover:underline"
                    >
                      {captain.display_name || 'Unnamed'}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {captain.whatsapp_id}
                    </span>
                  </TableCell>
                  <TableCell>{captain.boat_name || '-'}</TableCell>
                  <TableCell>{getStatusBadge(captain)}</TableCell>
                  <TableCell className="text-right">
                    {captain.total_trips ?? 0}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatAED(captain.total_revenue_aed ?? 0)}
                  </TableCell>
                  <TableCell>
                    {captain.stripe_charges_enabled ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="outline">Not Connected</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
