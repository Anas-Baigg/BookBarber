import { redirect } from 'next/navigation';
import AdminShell from '@/components/admin/AdminShell';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Admin Panel' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = (profile as { role?: string } | null)?.role;
  if (role !== 'admin') {
    redirect(role === 'employee' ? '/employee' : '/dashboard');
  }

  return <AdminShell userId={user.id}>{children}</AdminShell>;
}
