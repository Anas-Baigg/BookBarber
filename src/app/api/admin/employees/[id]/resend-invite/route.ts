import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: emp } = await admin
    .from('employees')
    .select('id, name, invite_email, activated_notified, user_id, shop:shops(owner_id)')
    .eq('id', params.id)
    .single();

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const shop = (emp.shop as unknown) as { owner_id: string } | null;
  if (shop?.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (emp.activated_notified) {
    return NextResponse.json(
      { error: 'This employee has already set up their account.' },
      { status: 409 }
    );
  }

  // Resolve the invite email: stored column first, then fall back to profile
  let email = (emp.invite_email as string | null);
  if (!email && emp.user_id) {
    const { data: profile } = await admin
      .from('profiles')
      .select('email')
      .eq('id', emp.user_id as string)
      .single();
    email = profile?.email ?? null;
  }

  if (!email) {
    return NextResponse.json({ error: 'No email address found for this employee.' }, { status: 400 });
  }

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: emp.name, role: 'employee' },
    redirectTo: `${APP_URL}/auth/callback`,
  });

  if (inviteErr) {
    return NextResponse.json({ error: inviteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email });
}
