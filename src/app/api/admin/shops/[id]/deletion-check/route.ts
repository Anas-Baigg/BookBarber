import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: shop } = await admin
    .from('shops')
    .select('id, owner_id')
    .eq('id', params.id)
    .single();

  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (shop.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const now = new Date().toISOString();

  const [{ count: futureBookings }, { count: employees }, { count: services }] = await Promise.all([
    admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', params.id)
      .in('status', ['confirmed', 'checked_in'])
      .gt('start_time', now),
    admin
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', params.id),
    admin
      .from('services')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', params.id)
      .eq('is_active', true),
  ]);

  return NextResponse.json({
    futureBookings: futureBookings ?? 0,
    employees: employees ?? 0,
    services: services ?? 0,
  });
}
