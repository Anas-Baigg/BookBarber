import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await (admin.auth.admin as unknown as {
    signOut: (userId: string, scope: 'others') => Promise<{ error: unknown }>;
  }).signOut(user.id, 'others');

  if (error) return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
