import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendAppointmentReminder } from '@/lib/emails';

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const CRON_TOKEN = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (CRON_TOKEN && auth !== `Bearer ${CRON_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  // 1-hour window centred on exactly 24 hours ahead: 23.5 h – 24.5 h.
  // Running hourly ensures every appointment time of day is covered by exactly one run.
  const now         = Date.now();
  const windowStart = new Date(now + 23.5 * 60 * 60 * 1000).toISOString();
  const windowEnd   = new Date(now + 24.5 * 60 * 60 * 1000).toISOString();

  const { data: bookings, error } = await admin
    .from('bookings')
    .select(`
      id, start_time,
      customer:profiles!bookings_customer_id_fkey(full_name, email),
      employee:employees(id, name),
      shop:shops(id, name, timezone, address)
    `)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd);

  if (error) {
    console.error('[cron/send-reminders] query error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  for (const booking of bookings ?? []) {
    const customer = (booking.customer as unknown) as { full_name: string | null; email: string } | null;
    const employee = (booking.employee as unknown) as { id: string; name: string } | null;
    const shop     = (booking.shop     as unknown) as { id: string; name: string; timezone: string; address: string | null } | null;

    if (!customer?.email) continue;

    try {
      await sendAppointmentReminder({
        customerName:  customer.full_name ?? 'Customer',
        customerEmail: customer.email,
        shopName:      shop?.name         ?? '',
        shopAddress:   shop?.address      ?? null,
        barberName:    employee?.name     ?? '',
        startTime:     booking.start_time,
        timezone:      shop?.timezone     ?? 'UTC',
        bookingId:     booking.id,
        appUrl:        APP_URL,
      });
      sent++;
    } catch (err) {
      console.error(`[cron/send-reminders] email failed for booking ${booking.id}:`, err);
    }
  }

  console.log(`[cron/send-reminders] sent ${sent} reminders`);
  return NextResponse.json({ sent });
}
