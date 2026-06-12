import { NextRequest, NextResponse } from 'next/server';
import { fromZonedTime } from 'date-fns-tz';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDateTimeInZone } from '@/lib/utils';
import { getAvailableReplacements } from '@/lib/replacement-barbers';
import {
  sendBarberReassigned,
  sendRescheduleOffer,
  sendEmergencyCancellation,
  sendUnavailabilitySummary,
  sendBookingAssigned,
  sendEmployeeScheduleChanged,
} from '@/lib/emails';
import type { UnavailabilityAction } from '@/types';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// ── GET — return affected bookings + free replacement barbers per slot ─────────
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get('employeeId');
  const date       = searchParams.get('date');
  const startTime  = searchParams.get('startTime'); // optional HH:MM
  const endTime    = searchParams.get('endTime');   // optional HH:MM

  if (!employeeId || !date) {
    return NextResponse.json({ error: 'employeeId and date required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify this admin owns the employee's shop
  const { data: emp } = await admin
    .from('employees')
    .select('id, name, shop_id, shop:shops(owner_id, timezone)')
    .eq('id', employeeId)
    .single();

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const shop = (emp.shop as unknown) as { owner_id: string; timezone: string } | null;
  if (shop?.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const timezone = shop?.timezone ?? 'UTC';

  // Build the time window for affected bookings
  const dayStart = startTime
    ? buildUTCTimestamp(date, startTime, timezone)
    : `${date}T00:00:00.000Z`;
  const dayEnd = endTime
    ? buildUTCTimestamp(date, endTime, timezone)
    : `${date}T23:59:59.999Z`;

  const { data: affectedBookings } = await admin
    .from('bookings')
    .select(`
      id, start_time, end_time,
      customer:profiles!bookings_customer_id_fkey(full_name, email)
    `)
    .eq('employee_id', employeeId)
    .eq('status', 'confirmed')
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd);

  if (!affectedBookings || affectedBookings.length === 0) {
    return NextResponse.json({ affectedBookings: [], availableBySlot: {} });
  }

  // Use shared utility for available replacements (Fix 7):
  // excludes barbers with TOR, day-off overrides, non-working schedule days,
  // and uses slot generator to confirm exact-slot availability.
  const { data: shopData } = await admin
    .from('shops')
    .select('default_open_time, default_close_time')
    .eq('id', emp.shop_id)
    .single();

  const availableBySlot = await getAvailableReplacements({
    shopId:            emp.shop_id,
    excludeEmployeeId: employeeId,
    date,
    bookings: affectedBookings.map((b) => ({
      bookingId: b.id,
      startUtc:  b.start_time,
      endUtc:    b.end_time,
    })),
    shopTimezone:     timezone,
    defaultOpenTime:  shopData?.default_open_time  ?? '09:00',
    defaultCloseTime: shopData?.default_close_time ?? '18:00',
  });

  return NextResponse.json({ affectedBookings, availableBySlot });
}

// ── POST — apply actions + save override + send emails ────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    employeeId,
    date,
    startTime,
    endTime,
    reason,
    notes,
    actions,
  }: {
    employeeId: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    reason: string;
    notes: string | null;
    actions: UnavailabilityAction[];
  } = body;

  if (!employeeId || !date) {
    return NextResponse.json({ error: 'employeeId and date required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify admin ownership
  const { data: emp } = await admin
    .from('employees')
    .select('id, name, shop_id, user_id, shop:shops(owner_id, name, timezone, slug, address)')
    .eq('id', employeeId)
    .single();

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const shop = (emp.shop as unknown) as { owner_id: string; name: string; timezone: string; slug: string; address?: string | null } | null;
  if (shop?.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const timezone    = shop?.timezone ?? 'UTC';
  const shopName    = shop?.name     ?? '';
  const shopSlug    = shop?.slug     ?? '';
  const shopAddress = shop?.address  ?? null;

  // Save the unavailability override
  const { error: overrideError } = await admin
    .from('employee_schedule_overrides')
    .upsert({
      employee_id: employeeId,
      date,
      is_working: false,
      start_time: startTime ?? null,
      end_time:   endTime   ?? null,
      reason:     reason    ?? 'other',
      notes:      notes     ?? null,
      created_by: user.id,
    }, { onConflict: 'employee_id,date' });

  if (overrideError) {
    return NextResponse.json({ error: overrideError.message }, { status: 500 });
  }

  // Fetch admin email for summary
  const { data: adminProfile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .single();

  const actionList = actions ?? [];

  // Validate all reassign actions have a barber selected
  for (const act of actionList) {
    if (act.action === 'reassign' && !act.newEmployeeId) {
      return NextResponse.json(
        { error: 'A replacement barber must be selected for all reassign actions.' },
        { status: 400 }
      );
    }
  }

  // Bulk-fetch all affected bookings in one query
  const bookingIds = actionList.map((a) => a.bookingId);
  const bookingMap = new Map<string, {
    id: string; start_time: string; end_time: string; shop_id: string; customer: unknown;
  }>();
  if (bookingIds.length > 0) {
    const { data: bookingRows } = await admin
      .from('bookings')
      .select(`id, start_time, end_time, shop_id, customer:profiles!bookings_customer_id_fkey(full_name, email)`)
      .in('id', bookingIds);
    for (const b of bookingRows ?? []) bookingMap.set(b.id, b);
  }

  // Pre-fetch new employee data for reassign actions
  const newEmpMap = new Map<string, { id: string; name: string; user_id: string | null; profileEmail?: string }>();
  for (const act of actionList) {
    if (act.action === 'reassign' && act.newEmployeeId && !newEmpMap.has(act.newEmployeeId)) {
      const { data: newEmp } = await admin
        .from('employees')
        .select('id, name, user_id')
        .eq('id', act.newEmployeeId)
        .single();
      if (newEmp) {
        const entry: { id: string; name: string; user_id: string | null; profileEmail?: string } = {
          id: newEmp.id, name: newEmp.name, user_id: newEmp.user_id,
        };
        if (newEmp.user_id) {
          const { data: np } = await admin.from('profiles').select('email').eq('id', newEmp.user_id).single();
          if (np?.email) entry.profileEmail = np.email;
        }
        newEmpMap.set(act.newEmployeeId, entry);
      }
    }
  }

  // Process all booking actions atomically via RPC
  if (actionList.length > 0) {
    const rpcPayload = actionList.map((a) => ({
      booking_id:      a.bookingId,
      action:          a.action,
      new_employee_id: a.newEmployeeId ?? null,
    }));
    const { error: rpcError } = await (admin as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>
    }).rpc('process_booking_actions', { p_actions: rpcPayload });
    if (rpcError) {
      console.error('[unavailability POST] RPC failed:', rpcError);
      return NextResponse.json({ error: 'Failed to process booking actions.' }, { status: 500 });
    }
  }

  // Send emails and build summary after successful RPC
  const summaryRows: Array<{
    customerName: string;
    customerEmail: string;
    startTime: string;
    action: string;
    newBarberName?: string;
  }> = [];

  for (const act of actionList) {
    const booking = bookingMap.get(act.bookingId);
    if (!booking) continue;

    const customer      = (booking.customer as unknown) as { full_name: string | null; email: string } | null;
    const customerName  = customer?.full_name ?? 'Customer';
    const customerEmail = customer?.email     ?? '';
    const formattedTime = formatDateTimeInZone(booking.start_time, timezone);

    const emailBase = {
      customerName, customerEmail, shopName, shopAddress, shopSlug,
      barberName: emp.name, startTime: booking.start_time, timezone,
      bookingId: booking.id, appUrl: APP_URL,
    };

    if (act.action === 'cancel') {
      if (customerEmail) {
        try {
          await sendEmergencyCancellation(emailBase);
        } catch (err) {
          console.error('[unavailability] cancel email failed:', err);
        }
      }
      summaryRows.push({ customerName, customerEmail, startTime: formattedTime, action: 'Cancelled' });

    } else if (act.action === 'offer_reschedule') {
      const rescheduleDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      if (customerEmail) {
        try {
          await sendRescheduleOffer({ ...emailBase, rescheduleDeadline });
        } catch (err) {
          console.error('[unavailability] reschedule offer email failed:', err);
        }
      }
      summaryRows.push({ customerName, customerEmail, startTime: formattedTime, action: 'Offered Reschedule' });

    } else if (act.action === 'reassign' && act.newEmployeeId) {
      const newEmp = newEmpMap.get(act.newEmployeeId);
      if (!newEmp) continue;

      if (customerEmail) {
        try {
          await sendBarberReassigned({ ...emailBase, newBarberName: newEmp.name });
        } catch (err) {
          console.error('[unavailability] reassign customer email failed:', err);
        }
      }
      if (newEmp.profileEmail) {
        try {
          await sendBookingAssigned({
            employeeEmail: newEmp.profileEmail,
            employeeName:  newEmp.name,
            customerName,
            shopName,
            startTime: booking.start_time,
            timezone,
            bookingId: booking.id,
            appUrl:    APP_URL,
          });
        } catch (err) {
          console.error('[unavailability] assigned barber email failed:', err);
        }
      }
      summaryRows.push({
        customerName, customerEmail,
        startTime: formattedTime,
        action: 'Reassigned',
        newBarberName: newEmp.name,
      });
    }
  }

  // Notify the employee that their schedule was changed
  if (emp.user_id) {
    try {
      const { data: empProfile } = await admin
        .from('profiles').select('email').eq('id', emp.user_id).single();
      if (empProfile?.email) {
        await sendEmployeeScheduleChanged({
          employeeEmail: empProfile.email,
          employeeName:  emp.name,
          date,
          type:          'day_off',
          notes:         notes ?? null,
          shopName,
          appUrl:        APP_URL,
        });
      }
    } catch (err) {
      console.error('[unavailability POST] employee schedule notify failed:', err);
    }
  }

  // Send admin summary email
  if (adminProfile?.email && summaryRows.length > 0) {
    try {
      await sendUnavailabilitySummary({
        adminEmail:   adminProfile.email,
        employeeName: emp.name,
        shopName,
        date,
        timezone,
        rows: summaryRows,
        appUrl: APP_URL,
      });
    } catch (err) {
      console.error('[unavailability] admin summary email failed:', err);
    }
  }

  return NextResponse.json({ ok: true });
}

function buildUTCTimestamp(date: string, hhmm: string, timezone: string): string {
  return fromZonedTime(`${date}T${hhmm}:00`, timezone).toISOString();
}
