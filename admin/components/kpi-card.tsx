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
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
        {change !== undefined && (
          <p
            className={`text-xs mt-1 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}
          >
            {change >= 0 ? '+' : ''}
            {change.toFixed(1)}% vs last period
          </p>
        )}
      </CardContent>
    </Card>
  );
}
