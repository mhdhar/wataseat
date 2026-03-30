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
  CalendarDays,
  Ticket,
  Settings,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/payouts', label: 'Payouts', icon: Wallet },
  { href: '/finances', label: 'Finances', icon: BarChart3 },
  { href: '/captains', label: 'Captains', icon: Anchor },
  { href: '/trips', label: 'Trips', icon: Ship },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/bookings', label: 'Bookings', icon: Ticket },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <aside className="w-64 border-r bg-white min-h-screen flex flex-col">
      <div className="px-6 py-6">
        <h1 className="text-xl font-bold tracking-tight">WataSeat</h1>
        <p className="text-sm text-muted-foreground">Admin Dashboard</p>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
