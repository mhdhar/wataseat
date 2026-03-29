'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface RevenueChartProps {
  data: { period: string; revenue: number; commission: number; payouts: number }[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
        No data for selected period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="period" />
        <YAxis />
        <Tooltip formatter={(value) => `AED ${Number(value).toLocaleString()}`} />
        <Legend />
        <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" />
        <Bar dataKey="commission" fill="#10b981" name="Commission" />
        <Bar dataKey="payouts" fill="#f59e0b" name="Captain Payouts" />
      </BarChart>
    </ResponsiveContainer>
  );
}
