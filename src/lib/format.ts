export function formatPrice(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '';
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}
