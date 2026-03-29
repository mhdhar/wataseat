import { redirect } from 'next/navigation';
import { getAdminSettings } from '@/lib/queries';
import { updateSettings } from './actions';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const params = await searchParams;
  const settings = await getAdminSettings();

  async function saveSettings(formData: FormData) {
    'use server';
    await updateSettings(formData);
    redirect('/settings?saved=true');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage platform configuration
        </p>
      </div>

      {params.saved === 'true' && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          Settings saved successfully.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Platform Settings</CardTitle>
          <CardDescription>
            Configure commission rates, contact details, and notification
            thresholds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveSettings} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="commission_percentage">
                Commission Percentage
              </Label>
              <Input
                id="commission_percentage"
                name="commission_percentage"
                type="number"
                min={0}
                max={100}
                step={0.1}
                defaultValue={settings.commission_percentage ?? '10'}
                placeholder="10"
              />
              <p className="text-sm text-muted-foreground">
                Platform fee charged on each booking (%).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin_whatsapp_number">
                Admin WhatsApp Number
              </Label>
              <Input
                id="admin_whatsapp_number"
                name="admin_whatsapp_number"
                type="text"
                defaultValue={settings.admin_whatsapp_number ?? ''}
                placeholder="+971501234567"
              />
              <p className="text-sm text-muted-foreground">
                WhatsApp number for admin notifications.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="payout_reminder_hours">
                Payout Reminder Threshold (hours)
              </Label>
              <Input
                id="payout_reminder_hours"
                name="payout_reminder_hours"
                type="number"
                min={1}
                defaultValue={settings.payout_reminder_hours ?? '48'}
                placeholder="48"
              />
              <p className="text-sm text-muted-foreground">
                Send a reminder if a payout has been pending for this many
                hours.
              </p>
            </div>

            <Button type="submit">Save Settings</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
