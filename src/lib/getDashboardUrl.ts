export function getDashboardUrl(role: string | null | undefined): string {
  if (role === 'admin') return '/admin';
  if (role === 'employee') return '/employee';
  return '/dashboard';
}
