// Platform configuration constants
export const PLATFORM_COMMISSION_RATE = parseFloat(process.env.PLATFORM_COMMISSION_RATE || '0.10'); // 10%
export const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || 'wataseat.com/support';

// Calculate commission amounts
export function calculateCommission(amountAed: number): { fee: number; payout: number; feeInFils: number } {
  const fee = Math.round(amountAed * PLATFORM_COMMISSION_RATE * 100) / 100;
  const payout = Math.round((amountAed - fee) * 100) / 100;
  const feeInFils = Math.round(amountAed * PLATFORM_COMMISSION_RATE * 100); // For Stripe (fils)
  return { fee, payout, feeInFils };
}
