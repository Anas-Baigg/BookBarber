import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmergencyCancellation, sendEmployeeBookingCancelled } from '@/lib/emails';

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const CRON_TOKEN = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Vercel cron sends the CRON_SECRET as a bearer token
  const auth = request.headers.get('authorization');
  if (CRON_TOKEN && auth !== `Bearer ${CRON_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find all pending_reschedule bookings whose deadline has passed
  const { data: expired, error } = await admin
    .from('bookings')
    .select(`
      id, start_time, employee_id, shop_id,
      customer:profiles!bookings_customer_id_fkey(full_name, email),
      employee:employees(name, user_id),
      shop:shops(name, timezone, slug, address)
    `)
    .eq('status', 'pending_reschedule')
    .lt('reschedule_deadline', new Date().toISOString());

  if (error) {
    console.error('[cron/expire-reschedules] query error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!expired || expired.length === 0) {
    return NextResponse.json({ cancelled: 0 });
  }

  const ids = expired.map((b) => b.id);
  const { error: updateError } = await admin
    .from('bookings')
    .update({ status: 'cancelled', reschedule_deadline: null, was_pending_reschedule: true })
    .in('id', ids);

  if (updateError) {
    console.error('[cron/expire-reschedules] update error:', updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Send cancellation emails
  for (const booking of expired) {
    const customer = (booking.customer as unknown) as { full_name: string | null; email: string } | null;
    const employee = (booking.employee as unknown) as { name: string; user_id: string | null } | null;
    const shop     = (booking.shop     as unknown) as { name: string; timezone: string; slug: string; address?: string | null } | null;

    const customerName = customer?.full_name ?? 'Customer';
    const shopName     = shop?.name      ?? '';
    const timezone     = shop?.timezone  ?? 'UTC';

    // Notify customer
    if (customer?.email) {
      try {
        await sendEmergencyCancellation({
          customerName,
          customerEmail: customer.email,
          shopName,
          shopAddress:   shop?.address   ?? null,
          barberName:    employee?.name  ?? '',
          startTime:     booking.start_time,
          timezone,
          bookingId:     booking.id,
          shopSlug:      shop?.slug      ?? '',
          appUrl:        APP_URL,
        });
      } catch (err) {
        console.error(`[cron/expire-reschedules] customer email failed for booking ${booking.id}:`, err);
      }
    }

    // Notify assigned employee
    if (employee?.user_id) {
      try {
        const { data: empProfile } = await admin
          .from('profiles').select('email').eq('id', employee.user_id).single();
        if (empProfile?.email) {
          await sendEmployeeBookingCancelled({
            employeeEmail: empProfile.email,
            employeeName:  employee.name,
            customerName,
            startTime:     booking.start_time,
            timezone,
            shopName,
            reason:        'Pending reschedule expired — auto-cancelled after 24 hours',
            appUrl:        APP_URL,
          });
        }
      } catch (err) {
        console.error(`[cron/expire-reschedules] employee email failed for booking ${booking.id}:`, err);
      }
    }
  }

  console.log(`[cron/expire-reschedules] cancelled ${ids.length} expired pending_reschedule bookings`);
  return NextResponse.json({ cancelled: ids.length });
}
