'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { TableHead } from '@/components/ui/table';

interface SortableHeaderProps {
  column: string;
  label: string;
  className?: string;
}

export function SortableHeader({ column, label, className }: SortableHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentSort = searchParams.get('sort');
  const currentOrder = searchParams.get('order') || 'asc';
  const isActive = currentSort === column;

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', column);
    if (isActive && currentOrder === 'asc') {
      params.set('order', 'desc');
    } else {
      params.set('order', 'asc');
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/50 transition-colors ${className ?? ''}`}
      onClick={handleClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          <span className="text-xs">{currentOrder === 'asc' ? '▲' : '▼'}</span>
        ) : (
          <span className="text-xs text-muted-foreground/40">⇅</span>
        )}
      </span>
    </TableHead>
  );
}
