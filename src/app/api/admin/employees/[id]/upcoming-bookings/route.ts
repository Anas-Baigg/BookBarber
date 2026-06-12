import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAvailableReplacements } from '@/lib/replacement-barbers';
import { fromZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: emp } = await admin
    .from('employees')
    .select('id, shop_id, shop:shops(owner_id, timezone, default_open_time, default_close_time, name)')
    .eq('id', params.id)
    .single();

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const shop = (emp.shop as unknown) as {
    owner_id: string; timezone: string;
    default_open_time: string; default_close_time: string; name: string;
  } | null;

  if (shop?.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date().toISOString();

  const { data: bookings } = await admin
    .from('bookings')
    .select(`
      id, start_time, end_time,
      customer:profiles!bookings_customer_id_fkey(full_name, email)
    `)
    .eq('employee_id', params.id)
    .in('status', ['confirmed', 'checked_in'])
    .gt('start_time', now)
    .order('start_time', { ascending: true });

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ bookings: [], availableBySlot: {}, shopTimezone: shop?.timezone ?? 'UTC', shopName: shop?.name ?? '' });
  }

  // Group bookings by date to call getAvailableReplacements once per date
  const byDate: Record<string, typeof bookings> = {};
  const tz = shop?.timezone ?? 'UTC';
  for (const b of bookings) {
    const d = format(toZonedTime(new Date(b.start_time), tz), 'yyyy-MM-dd');
    (byDate[d] ??= []).push(b);
  }

  const availableBySlot: Record<string, { id: string; name: string }[]> = {};

  for (const [date, dateBkgs] of Object.entries(byDate)) {
    const slotArgs = dateBkgs.map((b) => ({
      bookingId: b.id,
      startUtc:  b.start_time,
      endUtc:    b.end_time,
    }));
    const replacements = await getAvailableReplacements({
      shopId:           emp.shop_id,
      excludeEmployeeId: params.id,
      date,
      bookings:         slotArgs,
      shopTimezone:     tz,
      defaultOpenTime:  shop?.default_open_time  ?? '09:00',
      defaultCloseTime: shop?.default_close_time ?? '18:00',
    });
    Object.assign(availableBySlot, replacements);
  }

  return NextResponse.json({
    bookings,
    availableBySlot,
    shopTimezone: tz,
    shopName:     shop?.name ?? '',
  });
}
