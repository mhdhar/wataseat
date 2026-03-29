# WataSeat Admin Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Next.js admin dashboard for WataSeat's platform owner to manage payouts, finances, captains, trips, and bookings — with WhatsApp integration for captain notifications.

**Architecture:** Next.js 14+ App Router in `admin/` directory, reading directly from the existing Supabase database via server components. Mutations via server actions. WhatsApp sends via the existing Express bot API. Single hardcoded admin user with JWT cookie auth.

**Tech Stack:** Next.js 14+, Tailwind CSS, shadcn/ui, Supabase JS, jose (JWT), recharts (charts)

**Design doc:** `docs/plans/2026-03-29-admin-dashboard-design.md`

---

## Phase 1: Foundation (Tasks 1-4)

### Task 1: Database Migrations

**Files:**
- Modify: `supabase/migrations/run_migrations.ts` (append new migrations)
- Modify: `src/types/index.ts` (add new types)

**Step 1: Add migrations to run_migrations.ts**

Append these migrations to the `migrations` array:

```typescript
{
  name: '008_payouts',
  sql: `
    CREATE TABLE IF NOT EXISTS payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      trip_id UUID NOT NULL REFERENCES trips(id),
      captain_id UUID NOT NULL REFERENCES captains(id),
      gross_amount NUMERIC(10,2) NOT NULL,
      commission_amount NUMERIC(10,2) NOT NULL,
      payout_amount NUMERIC(10,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      bank_reference TEXT,
      processed_at TIMESTAMPTZ,
      whatsapp_notified BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    DROP TRIGGER IF EXISTS payouts_updated_at ON payouts;
    CREATE TRIGGER payouts_updated_at
      BEFORE UPDATE ON payouts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();

    CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
    CREATE INDEX IF NOT EXISTS idx_payouts_captain ON payouts(captain_id);

    ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
  `,
},
{
  name: '009_captains_bank_details',
  sql: `
    ALTER TABLE captains ADD COLUMN IF NOT EXISTS bank_name TEXT;
    ALTER TABLE captains ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;
  `,
},
{
  name: '010_admin_settings',
  sql: `
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    INSERT INTO admin_settings (key, value) VALUES
      ('commission_percentage', '10'),
      ('admin_whatsapp_number', ''),
      ('payout_reminder_hours', '48')
    ON CONFLICT (key) DO NOTHING;
  `,
},
```

**Step 2: Add TypeScript types to `src/types/index.ts`**

```typescript
export type PayoutStatus = 'pending' | 'processing' | 'completed';

export interface Payout {
  id: string;
  created_at: string;
  updated_at: string;
  trip_id: string;
  captain_id: string;
  gross_amount: number;
  commission_amount: number;
  payout_amount: number;
  status: PayoutStatus;
  bank_reference: string | null;
  processed_at: string | null;
  whatsapp_notified: boolean;
}

export interface AdminSetting {
  key: string;
  value: string;
  updated_at: string;
}
```

**Step 3: Run migrations**

Run: `npx tsx supabase/migrations/run_migrations.ts`
Expected: All migrations pass, `payouts` and `admin_settings` tables created.

**Step 4: Commit**

```bash
git add supabase/migrations/run_migrations.ts src/types/index.ts
git commit -m "feat: add payouts, admin_settings tables and captain bank fields"
```

---

### Task 2: Express Admin API Endpoint

**Files:**
- Create: `src/routes/admin.ts`
- Modify: `src/server.ts` (register route)

**Step 1: Create admin route**

Create `src/routes/admin.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { sendTemplateMessage } from '../services/whatsapp';

const router = Router();

// Verify admin secret on all requests
router.use((req: Request, res: Response, next) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// Send WhatsApp template message
router.post('/send-whatsapp', async (req: Request, res: Response) => {
  const { to, templateName, templateParams } = req.body;

  if (!to || !templateName) {
    res.status(400).json({ error: 'Missing required fields: to, templateName' });
    return;
  }

  try {
    await sendTemplateMessage(to, templateName, templateParams || []);
    logger.info({ to, templateName }, 'Admin WhatsApp message sent');
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message, to, templateName }, 'Admin WhatsApp send failed');
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
```

**Step 2: Register in server.ts**

Add import and route registration after existing routes:

```typescript
import adminRouter from './routes/admin';
// ... after other app.use routes:
app.use('/api/admin', adminRouter);
```

**Step 3: Add ADMIN_API_SECRET to .env**

Add to `.env`:
```
ADMIN_API_SECRET=your-secret-here
```

**Step 4: Verify**

Run: `npm run dev`
Test: `curl -X POST http://localhost:3000/api/admin/send-whatsapp -H "Content-Type: application/json" -H "X-Admin-Secret: wrong" -d '{}'`
Expected: 401 Unauthorized

**Step 5: Commit**

```bash
git add src/routes/admin.ts src/server.ts
git commit -m "feat: add admin API endpoint for WhatsApp sends"
```

---

### Task 3: Next.js Project Scaffold

**Files:**
- Create: `admin/` directory with Next.js project

**Step 1: Initialize Next.js project**

```bash
cd admin
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --no-turbopack
```

**Step 2: Install dependencies**

```bash
cd admin
npm install @supabase/supabase-js jose recharts date-fns
npx shadcn@latest init -d
```

Select defaults for shadcn init (New York style, Zinc base color).

**Step 3: Install shadcn components**

```bash
cd admin
npx shadcn@latest add button card input label table badge dialog select tabs separator dropdown-menu sheet avatar toast sonner
```

**Step 4: Set up environment variables**

Create `admin/.env.local`:
```
SUPABASE_URL=<same as bot .env>
SUPABASE_SERVICE_ROLE_KEY=<same as bot .env>
ADMIN_EMAIL=mo@wataseat.com
ADMIN_PASSWORD=<strong-password>
ADMIN_JWT_SECRET=<random-64-char-secret>
ADMIN_API_SECRET=<same as bot .env>
EXPRESS_BOT_URL=http://localhost:3000
```

**Step 5: Verify scaffold**

Run: `cd admin && npm run dev`
Expected: Next.js dev server starts on port 3001, default page renders.

**Step 6: Commit**

```bash
git add admin/
git commit -m "feat: scaffold Next.js admin dashboard"
```

---

### Task 4: Supabase Client + Auth

**Files:**
- Create: `admin/lib/supabase.ts`
- Create: `admin/lib/auth.ts`
- Create: `admin/lib/whatsapp.ts`
- Create: `admin/middleware.ts`
- Create: `admin/app/login/page.tsx`
- Create: `admin/app/login/actions.ts`

**Step 1: Create Supabase server client**

Create `admin/lib/supabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';

export function createServerSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
```

**Step 2: Create auth helpers**

Create `admin/lib/auth.ts`:

```typescript
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const JWT_SECRET = new TextEncoder().encode(process.env.ADMIN_JWT_SECRET!);
const COOKIE_NAME = 'wataseat_admin_session';

export async function createSession(): Promise<string> {
  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
  return token;
}

export async function verifySession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;

  try {
    await jwtVerify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}
```

**Step 3: Create WhatsApp client**

Create `admin/lib/whatsapp.ts`:

```typescript
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  templateParams: any[] = []
): Promise<void> {
  const res = await fetch(`${process.env.EXPRESS_BOT_URL}/api/admin/send-whatsapp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': process.env.ADMIN_API_SECRET!,
    },
    body: JSON.stringify({ to, templateName, templateParams }),
  });

  if (!res.ok) {
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }
}
```

**Step 4: Create middleware**

Create `admin/middleware.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.ADMIN_JWT_SECRET!);

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.next();
  }

  const token = request.cookies.get('wataseat_admin_session')?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    await jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login).*)'],
};
```

**Step 5: Create login page**

Create `admin/app/login/actions.ts`:

```typescript
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSession, getSessionCookieName } from '@/lib/auth';

export async function loginAction(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
    return { error: 'Invalid credentials' };
  }

  const token = await createSession();
  const cookieStore = await cookies();
  cookieStore.set(getSessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  redirect('/');
}
```

Create `admin/app/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { loginAction } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const [error, setError] = useState('');

  async function handleSubmit(formData: FormData) {
    const result = await loginAction(formData);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center">WataSeat Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={handleSubmit} className="space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            <Button type="submit" className="w-full">Sign In</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 6: Verify auth flow**

Run: `cd admin && npm run dev`
Test: Visit http://localhost:3001 — should redirect to /login. Login with env credentials — should redirect to /.

**Step 7: Commit**

```bash
git add admin/lib/ admin/middleware.ts admin/app/login/
git commit -m "feat: add auth, supabase client, whatsapp client, login page"
```

---

## Phase 2: Layout + Dashboard Home (Tasks 5-7)

### Task 5: App Layout with Sidebar

**Files:**
- Create: `admin/components/sidebar.tsx`
- Create: `admin/components/header.tsx`
- Modify: `admin/app/layout.tsx`

**Step 1: Create sidebar component**

Create `admin/components/sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Wallet,
  BarChart3,
  Anchor,
  Ship,
  Ticket,
  Settings,
} from 'lucide-react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/payouts', label: 'Payouts', icon: Wallet },
  { href: '/finances', label: 'Finances', icon: BarChart3 },
  { href: '/captains', label: 'Captains', icon: Anchor },
  { href: '/trips', label: 'Trips', icon: Ship },
  { href: '/bookings', label: 'Bookings', icon: Ticket },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-white min-h-screen p-4">
      <div className="mb-8">
        <h1 className="text-xl font-bold">WataSeat</h1>
        <p className="text-sm text-muted-foreground">Admin Dashboard</p>
      </div>
      <nav className="space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

**Step 2: Create header component**

Create `admin/components/header.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getSessionCookieName } from '@/lib/auth';

async function logoutAction() {
  'use server';
  const cookieStore = await cookies();
  cookieStore.delete(getSessionCookieName());
  redirect('/login');
}

export function Header() {
  return (
    <header className="border-b bg-white px-6 py-3 flex items-center justify-between">
      <div />
      <form action={logoutAction}>
        <Button variant="ghost" size="sm" type="submit">Logout</Button>
      </form>
    </header>
  );
}
```

**Step 3: Update root layout**

Replace `admin/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { Toaster } from '@/components/ui/sonner';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'WataSeat Admin',
  description: 'Admin dashboard for WataSeat booking platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 flex flex-col">
            <Header />
            <main className="flex-1 p-6 bg-gray-50">{children}</main>
          </div>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
```

**Step 4: Verify layout**

Run: `cd admin && npm run dev`
Expected: Sidebar with nav items visible. Clicking links navigates (404 pages expected for now).

**Step 5: Commit**

```bash
git add admin/components/ admin/app/layout.tsx
git commit -m "feat: add sidebar navigation and app layout"
```

---

### Task 6: Dashboard KPI Cards

**Files:**
- Create: `admin/app/page.tsx`
- Create: `admin/lib/queries.ts`
- Create: `admin/components/kpi-card.tsx`

**Step 1: Create query helpers**

Create `admin/lib/queries.ts`:

```typescript
import { createServerSupabase } from './supabase';

export async function getDashboardKPIs() {
  const supabase = createServerSupabase();

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Current period (last 30 days)
  const { data: currentBookings } = await supabase
    .from('bookings')
    .select('total_amount_aed, platform_fee_aed')
    .in('status', ['confirmed', 'authorized'])
    .gte('created_at', thirtyDaysAgo.toISOString());

  // Previous period (30-60 days ago)
  const { data: prevBookings } = await supabase
    .from('bookings')
    .select('total_amount_aed, platform_fee_aed')
    .in('status', ['confirmed', 'authorized'])
    .gte('created_at', sixtyDaysAgo.toISOString())
    .lt('created_at', thirtyDaysAgo.toISOString());

  const { count: activeTrips } = await supabase
    .from('trips')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open');

  const { data: pendingPayouts } = await supabase
    .from('payouts')
    .select('payout_amount')
    .eq('status', 'pending');

  const currentRevenue = currentBookings?.reduce((sum, b) => sum + Number(b.total_amount_aed), 0) || 0;
  const currentCommission = currentBookings?.reduce((sum, b) => sum + Number(b.platform_fee_aed || 0), 0) || 0;
  const prevRevenue = prevBookings?.reduce((sum, b) => sum + Number(b.total_amount_aed), 0) || 0;

  const pendingPayoutTotal = pendingPayouts?.reduce((sum, p) => sum + Number(p.payout_amount), 0) || 0;

  return {
    totalRevenue: currentRevenue,
    revenueChange: prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue) * 100 : 0,
    platformCommission: currentCommission,
    activeTrips: activeTrips || 0,
    pendingPayouts: pendingPayouts?.length || 0,
    pendingPayoutAmount: pendingPayoutTotal,
  };
}

export async function getRecentActivity(limit = 20) {
  const supabase = createServerSupabase();

  const { data: recentBookings } = await supabase
    .from('bookings')
    .select('id, created_at, guest_name, status, total_amount_aed, trip_id')
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data: recentTrips } = await supabase
    .from('trips')
    .select('id, created_at, title, status, trip_type')
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data: recentCaptains } = await supabase
    .from('captains')
    .select('id, created_at, display_name, onboarding_step')
    .order('created_at', { ascending: false })
    .limit(limit);

  // Merge and sort all activity by created_at
  const activities = [
    ...(recentBookings || []).map((b) => ({
      type: 'booking' as const,
      id: b.id,
      created_at: b.created_at,
      description: `${b.guest_name || 'Guest'} — ${b.status} (AED ${b.total_amount_aed})`,
    })),
    ...(recentTrips || []).map((t) => ({
      type: 'trip' as const,
      id: t.id,
      created_at: t.created_at,
      description: `${t.title} — ${t.status}`,
    })),
    ...(recentCaptains || []).map((c) => ({
      type: 'captain' as const,
      id: c.id,
      created_at: c.created_at,
      description: `${c.display_name} — ${c.onboarding_step}`,
    })),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);

  return activities;
}

export async function getAlerts() {
  const supabase = createServerSupabase();

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Trips within 24h that haven't hit threshold
  const { data: atRiskTrips } = await supabase
    .from('trips')
    .select('id, title, departure_at, current_bookings, threshold')
    .eq('status', 'open')
    .lte('departure_at', in24h.toISOString())
    .gte('departure_at', now.toISOString());

  const atRisk = (atRiskTrips || []).filter((t) => t.current_bookings < t.threshold);

  // Pending payouts older than 48h
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const { data: stalePayouts } = await supabase
    .from('payouts')
    .select('id, captain_id, payout_amount, created_at')
    .eq('status', 'pending')
    .lte('created_at', fortyEightHoursAgo.toISOString());

  // Captains stuck in onboarding
  const { data: stuckCaptains } = await supabase
    .from('captains')
    .select('id, display_name, onboarding_step')
    .not('onboarding_step', 'eq', 'complete');

  return {
    atRiskTrips: atRisk,
    stalePayouts: stalePayouts || [],
    stuckCaptains: stuckCaptains || [],
  };
}
```

**Step 2: Create KPI card component**

Create `admin/components/kpi-card.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface KPICardProps {
  title: string;
  value: string;
  subtitle?: string;
  change?: number;
}

export function KPICard({ title, value, subtitle, change }: KPICardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        {change !== undefined && (
          <p className={`text-xs mt-1 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs last period
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

**Step 3: Create dashboard page**

Replace `admin/app/page.tsx`:

```tsx
import { getDashboardKPIs, getRecentActivity, getAlerts } from '@/lib/queries';
import { KPICard } from '@/components/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const kpis = await getDashboardKPIs();
  const activity = await getRecentActivity();
  const alerts = await getAlerts();

  const totalAlerts = alerts.atRiskTrips.length + alerts.stalePayouts.length + alerts.stuckCaptains.length;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Dashboard</h2>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Revenue (30d)"
          value={`AED ${kpis.totalRevenue.toLocaleString()}`}
          change={kpis.revenueChange}
        />
        <KPICard
          title="Platform Commission (30d)"
          value={`AED ${kpis.platformCommission.toLocaleString()}`}
        />
        <KPICard
          title="Active Trips"
          value={kpis.activeTrips.toString()}
        />
        <KPICard
          title="Pending Payouts"
          value={kpis.pendingPayouts.toString()}
          subtitle={`AED ${kpis.pendingPayoutAmount.toLocaleString()} total`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Alerts
              {totalAlerts > 0 && <Badge variant="destructive">{totalAlerts}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.atRiskTrips.map((trip) => (
              <div key={trip.id} className="flex items-center justify-between text-sm">
                <span>Trip {trip.title} — {trip.current_bookings}/{trip.threshold} seats, departs soon</span>
                <Link href={`/trips/${trip.id}`}>
                  <Badge variant="outline">View</Badge>
                </Link>
              </div>
            ))}
            {alerts.stalePayouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span>Payout AED {p.payout_amount} pending &gt; 48h</span>
                <Link href="/payouts">
                  <Badge variant="outline">View</Badge>
                </Link>
              </div>
            ))}
            {alerts.stuckCaptains.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span>{c.display_name} stuck at {c.onboarding_step}</span>
                <Link href={`/captains/${c.id}`}>
                  <Badge variant="outline">View</Badge>
                </Link>
              </div>
            ))}
            {totalAlerts === 0 && <p className="text-sm text-muted-foreground">No alerts</p>}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activity.map((a) => (
                <div key={`${a.type}-${a.id}`} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{a.type}</Badge>
                    <span>{a.description}</span>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
              {activity.length === 0 && <p className="text-sm text-muted-foreground">No recent activity</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

**Step 4: Verify dashboard**

Run: `cd admin && npm run dev`
Expected: Dashboard page with 4 KPI cards, alerts panel, activity feed. Data may be empty if no records exist.

**Step 5: Commit**

```bash
git add admin/lib/queries.ts admin/components/kpi-card.tsx admin/app/page.tsx
git commit -m "feat: add dashboard home with KPI cards, alerts, activity feed"
```

---

### Task 7: Auto-Create Payouts on Trip Completion

**Files:**
- Modify: `src/jobs/thresholdCheck.ts` (add payout creation after capture)

**Step 1: Read `src/jobs/thresholdCheck.ts`**

Understand the existing `captureAllForTrip()` flow.

**Step 2: Add payout creation after capture**

After all payments are captured for a trip, insert a `payouts` record:

```typescript
// After captureAllForTrip succeeds and trip is marked confirmed:
const totalGross = confirmedBookings.reduce((sum, b) => sum + Number(b.total_amount_aed), 0);
const commissionRate = 0.10; // 10% platform fee
const commission = Math.round(totalGross * commissionRate * 100) / 100;
const payoutAmount = Math.round((totalGross - commission) * 100) / 100;

await supabase.from('payouts').insert({
  trip_id: trip.id,
  captain_id: trip.captain_id,
  gross_amount: totalGross,
  commission_amount: commission,
  payout_amount: payoutAmount,
  status: 'pending',
});
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 4: Commit**

```bash
git add src/jobs/thresholdCheck.ts
git commit -m "feat: auto-create payout record when trip is confirmed"
```

---

## Phase 3: Payout Management (Tasks 8-10)

### Task 8: Payout Queue Page

**Files:**
- Create: `admin/app/payouts/page.tsx`
- Create: `admin/app/payouts/actions.ts`
- Add to: `admin/lib/queries.ts`

**Step 1: Add payout queries to queries.ts**

```typescript
export async function getPendingPayouts() {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('payouts')
    .select('*, captains(display_name, iban, bank_name, whatsapp_id), trips(title, trip_type, departure_at)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return data || [];
}

export async function getPayoutHistory(filters?: { captain_id?: string; from?: string; to?: string }) {
  const supabase = createServerSupabase();
  let query = supabase
    .from('payouts')
    .select('*, captains(display_name), trips(title)')
    .eq('status', 'completed')
    .order('processed_at', { ascending: false });

  if (filters?.captain_id) query = query.eq('captain_id', filters.captain_id);
  if (filters?.from) query = query.gte('processed_at', filters.from);
  if (filters?.to) query = query.lte('processed_at', filters.to);

  const { data } = await query;
  return data || [];
}
```

**Step 2: Create payout actions**

Create `admin/app/payouts/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';

export async function markPayoutProcessed(payoutId: string, bankReference: string) {
  const supabase = createServerSupabase();

  const { data: payout } = await supabase
    .from('payouts')
    .select('*, captains(display_name, whatsapp_id), trips(title)')
    .eq('id', payoutId)
    .single();

  if (!payout) throw new Error('Payout not found');

  await supabase
    .from('payouts')
    .update({
      status: 'completed',
      bank_reference: bankReference,
      processed_at: new Date().toISOString(),
      whatsapp_notified: true,
    })
    .eq('id', payoutId);

  // Send WhatsApp notification to captain
  try {
    await sendWhatsAppTemplate(payout.captains.whatsapp_id, 'payout_processed', [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: payout.captains.display_name.split(' ')[0] },
          { type: 'text', text: payout.payout_amount.toString() },
          { type: 'text', text: payout.trips.title },
          { type: 'text', text: bankReference },
        ],
      },
    ]);
  } catch (err) {
    // Update to reflect notification failure
    await supabase
      .from('payouts')
      .update({ whatsapp_notified: false })
      .eq('id', payoutId);
  }

  revalidatePath('/payouts');
}
```

**Step 3: Create payouts page**

Create `admin/app/payouts/page.tsx` with:
- Tab layout: "Queue" and "History"
- Queue tab: table of pending payouts with captain name, IBAN, trip, amount, "Mark as Paid" button
- "Mark as Paid" opens a dialog to enter bank reference, calls `markPayoutProcessed`
- History tab: table of completed payouts with filters

Full component code should use shadcn Table, Dialog, Tabs, Badge components. Use client component wrapper for the dialog interaction.

**Step 4: Verify**

Run: `cd admin && npm run dev`
Navigate to /payouts — should render empty queue and history tabs.

**Step 5: Commit**

```bash
git add admin/app/payouts/ admin/lib/queries.ts
git commit -m "feat: add payout queue and history pages"
```

---

### Task 9: Captain Management Pages

**Files:**
- Create: `admin/app/captains/page.tsx`
- Create: `admin/app/captains/[id]/page.tsx`
- Create: `admin/app/captains/actions.ts`
- Add to: `admin/lib/queries.ts`

**Step 1: Add captain queries**

```typescript
export async function getCaptains(filters?: { status?: string; search?: string }) {
  const supabase = createServerSupabase();
  let query = supabase
    .from('captains')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.search) {
    query = query.or(`display_name.ilike.%${filters.search}%,whatsapp_id.ilike.%${filters.search}%`);
  }

  const { data } = await query;
  return data || [];
}

export async function getCaptainDetail(id: string) {
  const supabase = createServerSupabase();
  const { data: captain } = await supabase
    .from('captains')
    .select('*')
    .eq('id', id)
    .single();

  const { data: trips } = await supabase
    .from('trips')
    .select('*')
    .eq('captain_id', id)
    .order('departure_at', { ascending: false });

  const { data: payouts } = await supabase
    .from('payouts')
    .select('*, trips(title)')
    .eq('captain_id', id)
    .order('created_at', { ascending: false });

  return { captain, trips: trips || [], payouts: payouts || [] };
}
```

**Step 2: Create captain actions**

Create `admin/app/captains/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';

export async function toggleSuspendCaptain(captainId: string, suspend: boolean) {
  const supabase = createServerSupabase();
  await supabase.from('captains').update({ is_suspended: suspend }).eq('id', captainId);
  revalidatePath(`/captains/${captainId}`);
  revalidatePath('/captains');
}

export async function updateCaptainBankDetails(captainId: string, bankName: string, iban: string) {
  const supabase = createServerSupabase();
  await supabase.from('captains').update({ bank_name: bankName, iban }).eq('id', captainId);
  revalidatePath(`/captains/${captainId}`);
}

export async function sendMessageToCaptain(captainWaId: string, templateName: string, params: any[]) {
  await sendWhatsAppTemplate(captainWaId, templateName, params);
}
```

**Step 3: Create captain list page**

`admin/app/captains/page.tsx` — table with columns: name, boat, status (active/onboarding/suspended), total trips, revenue, Stripe status. Search input. Each row links to detail page.

**Step 4: Create captain detail page**

`admin/app/captains/[id]/page.tsx` — profile card, bank details (editable), Stripe status, suspend/reactivate button, trip history table, payout history table, lifetime stats cards.

**Step 5: Verify**

Navigate to /captains — should list captains. Click a captain — should show detail page.

**Step 6: Commit**

```bash
git add admin/app/captains/ admin/lib/queries.ts
git commit -m "feat: add captain list and detail pages with bank details and suspend"
```

---

### Task 10: Trip Management Pages

**Files:**
- Create: `admin/app/trips/page.tsx`
- Create: `admin/app/trips/[id]/page.tsx`
- Create: `admin/app/trips/actions.ts`
- Add to: `admin/lib/queries.ts`

**Step 1: Add trip queries**

```typescript
export async function getTrips(filters?: { status?: string; captain_id?: string; from?: string; to?: string; search?: string }) {
  const supabase = createServerSupabase();
  let query = supabase
    .from('trips')
    .select('*, captains(display_name)')
    .order('departure_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.captain_id) query = query.eq('captain_id', filters.captain_id);
  if (filters?.search) query = query.ilike('title', `%${filters.search}%`);

  const { data } = await query;
  return data || [];
}

export async function getTripDetail(id: string) {
  const supabase = createServerSupabase();

  const { data: trip } = await supabase
    .from('trips')
    .select('*, captains(display_name, whatsapp_id)')
    .eq('id', id)
    .single();

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('trip_id', id)
    .order('created_at', { ascending: true });

  const { data: payout } = await supabase
    .from('payouts')
    .select('*')
    .eq('trip_id', id)
    .maybeSingle();

  return { trip, bookings: bookings || [], payout };
}
```

**Step 2: Create trip actions**

Create `admin/app/trips/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';

export async function adminCancelTrip(tripId: string) {
  const supabase = createServerSupabase();

  // Get trip and bookings
  const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).single();
  if (!trip) throw new Error('Trip not found');

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*')
    .eq('trip_id', tripId)
    .in('status', ['authorized', 'confirmed']);

  // Cancel trip
  await supabase.from('trips').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancellation_reason: 'Cancelled by admin',
  }).eq('id', tripId);

  // Cancel all bookings
  if (bookings?.length) {
    for (const booking of bookings) {
      await supabase.from('bookings').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'Trip cancelled by admin',
      }).eq('id', booking.id);

      // Notify guest
      try {
        await sendWhatsAppTemplate(booking.guest_whatsapp_id, 'trip_cancelled', [
          { type: 'body', parameters: [
            { type: 'text', text: booking.guest_name || 'there' },
            { type: 'text', text: trip.trip_type },
            { type: 'text', text: new Date(trip.departure_at).toLocaleDateString() },
            { type: 'text', text: trip.threshold.toString() },
          ]},
        ]);
      } catch {}
    }
  }

  revalidatePath('/trips');
  revalidatePath(`/trips/${tripId}`);
}
```

**Step 3: Create trip list page**

`admin/app/trips/page.tsx` — table with type, captain, date, status badge, fill rate (X/Y), threshold, financial summary. Filters for status and date range. Search by short ID.

**Step 4: Create trip detail page**

`admin/app/trips/[id]/page.tsx` — trip info card, guest list table (name, WA number, status, amount), financial summary card, "Cancel Trip" button with confirmation dialog, payout status.

**Step 5: Verify and commit**

```bash
git add admin/app/trips/ admin/lib/queries.ts
git commit -m "feat: add trip list and detail pages with admin cancel"
```

---

## Phase 4: Bookings + Finances (Tasks 11-13)

### Task 11: Booking Management Pages

**Files:**
- Create: `admin/app/bookings/page.tsx`
- Create: `admin/app/bookings/actions.ts`
- Add to: `admin/lib/queries.ts`

**Step 1: Add booking queries**

```typescript
export async function getBookings(filters?: { status?: string; trip_id?: string; from?: string; to?: string }) {
  const supabase = createServerSupabase();
  let query = supabase
    .from('bookings')
    .select('*, trips(title, trip_type)')
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.trip_id) query = query.eq('trip_id', filters.trip_id);

  const { data } = await query;
  return data || [];
}
```

**Step 2: Create refund action**

Create `admin/app/bookings/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';
import { sendWhatsAppTemplate } from '@/lib/whatsapp';

export async function refundBooking(bookingId: string) {
  const supabase = createServerSupabase();

  const { data: booking } = await supabase
    .from('bookings')
    .select('*, trips(title)')
    .eq('id', bookingId)
    .single();

  if (!booking) throw new Error('Booking not found');

  // Note: actual Stripe refund/cancel should be called here via the Express bot
  // For now, update the booking status
  await supabase.from('bookings').update({
    status: 'refunded',
    cancelled_at: new Date().toISOString(),
    cancellation_reason: 'Refunded by admin',
  }).eq('id', bookingId);

  // Notify guest
  try {
    await sendWhatsAppTemplate(booking.guest_whatsapp_id, 'booking_refunded', [
      { type: 'body', parameters: [
        { type: 'text', text: booking.guest_name || 'there' },
        { type: 'text', text: booking.trips.title },
      ]},
    ]);
  } catch {}

  revalidatePath('/bookings');
}
```

**Step 3: Create bookings page**

`admin/app/bookings/page.tsx` — table with guest, trip, status badge, amount, date. Filters for status. "Refund" button on each row with confirmation.

**Step 4: Verify and commit**

```bash
git add admin/app/bookings/ admin/lib/queries.ts
git commit -m "feat: add booking list page with refund action"
```

---

### Task 12: Financial Reports Page

**Files:**
- Create: `admin/app/finances/page.tsx`
- Create: `admin/components/revenue-chart.tsx`
- Create: `admin/lib/finance-queries.ts`

**Step 1: Create finance-specific queries**

Create `admin/lib/finance-queries.ts`:

```typescript
import { createServerSupabase } from './supabase';

export type Granularity = 'daily' | 'weekly' | 'monthly';

export async function getRevenueData(granularity: Granularity, from: string, to: string) {
  const supabase = createServerSupabase();

  const { data: bookings } = await supabase
    .from('bookings')
    .select('created_at, total_amount_aed, platform_fee_aed, captain_payout_aed, status')
    .in('status', ['confirmed', 'authorized'])
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: true });

  if (!bookings?.length) return [];

  // Group by period
  const grouped = new Map<string, { revenue: number; commission: number; payouts: number }>();

  for (const b of bookings) {
    const date = new Date(b.created_at);
    let key: string;
    if (granularity === 'daily') {
      key = date.toISOString().slice(0, 10);
    } else if (granularity === 'weekly') {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      key = weekStart.toISOString().slice(0, 10);
    } else {
      key = date.toISOString().slice(0, 7);
    }

    const existing = grouped.get(key) || { revenue: 0, commission: 0, payouts: 0 };
    existing.revenue += Number(b.total_amount_aed);
    existing.commission += Number(b.platform_fee_aed || 0);
    existing.payouts += Number(b.captain_payout_aed || 0);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries()).map(([period, data]) => ({
    period,
    ...data,
  }));
}

export async function getFinancialSummary(from: string, to: string) {
  const supabase = createServerSupabase();

  const { data: bookings } = await supabase
    .from('bookings')
    .select('total_amount_aed, platform_fee_aed, captain_payout_aed')
    .in('status', ['confirmed', 'authorized'])
    .gte('created_at', from)
    .lte('created_at', to);

  const totalRevenue = bookings?.reduce((s, b) => s + Number(b.total_amount_aed), 0) || 0;
  const totalCommission = bookings?.reduce((s, b) => s + Number(b.platform_fee_aed || 0), 0) || 0;
  const totalPayouts = bookings?.reduce((s, b) => s + Number(b.captain_payout_aed || 0), 0) || 0;

  return { totalRevenue, totalCommission, totalPayouts, bookingCount: bookings?.length || 0 };
}
```

**Step 2: Create revenue chart (client component)**

Create `admin/components/revenue-chart.tsx`:

```tsx
'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface RevenueChartProps {
  data: { period: string; revenue: number; commission: number; payouts: number }[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="period" />
        <YAxis />
        <Tooltip formatter={(value: number) => `AED ${value.toLocaleString()}`} />
        <Legend />
        <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" />
        <Bar dataKey="commission" fill="#10b981" name="Commission" />
        <Bar dataKey="payouts" fill="#f59e0b" name="Captain Payouts" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

**Step 3: Create finances page**

`admin/app/finances/page.tsx` — summary cards at top, chart below with granularity toggle (daily/weekly/monthly), date range picker. Uses search params for filtering.

**Step 4: Verify and commit**

```bash
git add admin/app/finances/ admin/components/revenue-chart.tsx admin/lib/finance-queries.ts
git commit -m "feat: add financial reports page with revenue charts"
```

---

### Task 13: CSV Export

**Files:**
- Create: `admin/app/finances/export/route.ts`
- Create: `admin/app/payouts/export/route.ts`

**Step 1: Create finance export route**

Create `admin/app/finances/export/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get('from') || '2020-01-01';
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString();

  const supabase = createServerSupabase();
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, created_at, guest_name, trip_id, total_amount_aed, platform_fee_aed, captain_payout_aed, status, trips(title)')
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false });

  const header = 'Date,Guest,Trip,Amount (AED),Commission (AED),Captain Payout (AED),Status\n';
  const rows = (bookings || []).map((b: any) =>
    `${b.created_at},${b.guest_name || 'N/A'},${b.trips?.title || 'N/A'},${b.total_amount_aed},${b.platform_fee_aed || 0},${b.captain_payout_aed || 0},${b.status}`
  ).join('\n');

  return new NextResponse(header + rows, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=wataseat-finances-${from}-${to}.csv`,
    },
  });
}
```

**Step 2: Create payout export route**

Create `admin/app/payouts/export/route.ts` — similar pattern for payout history export.

**Step 3: Add export buttons**

Add "Export CSV" buttons to the finances page and payout history page that link to the export routes.

**Step 4: Verify and commit**

```bash
git add admin/app/finances/export/ admin/app/payouts/export/
git commit -m "feat: add CSV export for finances and payouts"
```

---

## Phase 5: Settings + Polish (Tasks 14-16)

### Task 14: Admin Settings Page

**Files:**
- Create: `admin/app/settings/page.tsx`
- Create: `admin/app/settings/actions.ts`
- Add to: `admin/lib/queries.ts`

**Step 1: Add settings queries**

```typescript
export async function getAdminSettings() {
  const supabase = createServerSupabase();
  const { data } = await supabase.from('admin_settings').select('*');
  const settings: Record<string, string> = {};
  for (const row of data || []) {
    settings[row.key] = row.value;
  }
  return settings;
}
```

**Step 2: Create settings actions**

Create `admin/app/settings/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase';

export async function updateSettings(formData: FormData) {
  const supabase = createServerSupabase();

  const entries = [
    { key: 'commission_percentage', value: formData.get('commission_percentage') as string },
    { key: 'admin_whatsapp_number', value: formData.get('admin_whatsapp_number') as string },
    { key: 'payout_reminder_hours', value: formData.get('payout_reminder_hours') as string },
  ];

  for (const { key, value } of entries) {
    await supabase
      .from('admin_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() });
  }

  revalidatePath('/settings');
}
```

**Step 3: Create settings page**

`admin/app/settings/page.tsx` — simple form with:
- Commission percentage (number input)
- Admin WhatsApp number (text input)
- Payout reminder threshold (number input, hours)
- Save button

**Step 4: Verify and commit**

```bash
git add admin/app/settings/ admin/lib/queries.ts
git commit -m "feat: add admin settings page"
```

---

### Task 15: Per-Trip Financial Drill-Down

**Files:**
- Modify: `admin/app/trips/[id]/page.tsx` (add financial detail section)

**Step 1: Enhance trip detail page**

Add a "Financials" section to the existing trip detail page:
- Total collected (sum of all confirmed/authorized bookings)
- Platform commission (10%)
- Captain payout amount
- Payout status (pending/completed with link to payout)
- Per-guest breakdown table: guest name, amount, status (authorized/captured/cancelled/refunded)

**Step 2: Verify and commit**

```bash
git add admin/app/trips/
git commit -m "feat: add per-trip financial drill-down to trip detail page"
```

---

### Task 16: Final Polish + Type Check

**Files:**
- Various files for fixes

**Step 1: Run type check**

Run: `cd admin && npx tsc --noEmit`
Fix any type errors found.

**Step 2: Run lint**

Run: `cd admin && npm run lint`
Fix any lint errors.

**Step 3: Test all pages manually**

Visit each page and verify it renders:
- `/login` — login form
- `/` — dashboard with KPIs
- `/payouts` — queue and history tabs
- `/finances` — charts and export
- `/captains` — list and detail
- `/trips` — list and detail
- `/bookings` — list with refund
- `/settings` — settings form

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: polish admin dashboard, fix type and lint errors"
```

---

## Summary

| Phase | Tasks | What's Built |
|-------|-------|-------------|
| 1 | 1-4 | Database migrations, Express admin API, Next.js scaffold, auth |
| 2 | 5-7 | Layout, dashboard home (KPIs, alerts, activity), auto-create payouts |
| 3 | 8-10 | Payout queue/history, captain management, trip management |
| 4 | 11-13 | Booking management, financial reports with charts, CSV export |
| 5 | 14-16 | Settings page, per-trip financials, polish |

**Total: 16 tasks across 5 phases.**
