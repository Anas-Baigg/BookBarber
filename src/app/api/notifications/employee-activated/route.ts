import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmployeeActivatedNotice } from '@/lib/emails';
import { createNotification } from '@/lib/notifications';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: emp } = await admin
    .from('employees')
    .select('id, name, activated_notified, shop:shops(id, owner_id, name)')
    .eq('user_id', user.id)
    .maybeSingle();

  // No employee record or already notified — silent no-op
  if (!emp || emp.activated_notified) return NextResponse.json({ ok: true });

  const shop = (emp.shop as unknown) as { id: string; owner_id: string; name: string } | null;
  if (!shop) return NextResponse.json({ ok: true });

  const { data: ownerProfile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', shop.owner_id)
    .single();

  if (ownerProfile?.email) {
    try {
      await sendEmployeeActivatedNotice({
        adminEmail:   ownerProfile.email,
        employeeName: emp.name as string,
        shopName:     shop.name,
        appUrl:       APP_URL,
      });
    } catch (err) {
      console.error('[employee-activated] email failed:', err);
    }
  }

  await admin
    .from('employees')
    .update({ activated_notified: true })
    .eq('id', emp.id);

  await createNotification({
    shopId:      shop.id,
    recipientId: shop.owner_id,
    type:        'employee_activated',
    title:       'Employee Account Activated',
    body:        `${emp.name as string} has set up their account and can now log in`,
    employeeId:  emp.id as string,
  });

  return NextResponse.json({ ok: true });
}
