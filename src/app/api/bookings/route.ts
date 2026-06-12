import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateFutureBooking } from '@/lib/booking-time';
import {
  blockedMinutes,
  DEFAULT_SLOT_INTERVAL,
  DEFAULT_BUFFER,
} from '@/lib/slot-generator';
import { addMinutes, parseISO } from 'date-fns';
import {
  sendBookingConfirmation,
  sendEmployeeNewBookingNotice,
  sendAdminNewBookingNotice,
} from '@/lib/emails';
import { createNotification } from '@/lib/notifications';
import { formatDateTimeInZone } from '@/lib/utils';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// Legacy fallback for old bookings (created before service snapshot existed).
const LEGACY_SERVICE_DURATION = 25;

type CandidateBooking = {
  start_time: string;
  end_time: string;
  service_duration_minutes: number | null;
};

/** True if any existing booking's blocked range overlaps [start, end]. */
function hasConflict(
  start: Date,
  end: Date,
  existing: CandidateBooking[],
  bufferMinutes: number,
  slotIntervalMinutes: number,
): boolean {
  return existing.some((b) => {
    const bStart = parseISO(b.start_time);
    const dur    = b.service_duration_minutes ?? LEGACY_SERVICE_DURATION;
    const bEnd   = addMinutes(bStart, blockedMinutes(dur, bufferMinutes, slotIntervalMinutes));
    return start < bEnd && end > bStart;
  });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fix 4: only customers may create bookings via this endpoint.
  const role = (user.user_metadata?.role ?? user.app_metadata?.role) as string | undefined;
  if (role !== 'customer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fix 5: require a verified email before allowing a booking.
  if (!user.email_confirmed_at) {
    return NextResponse.json(
      { error: 'Please verify your email address before booking an appointment.' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { shopId, employeeId, startTime, serviceId, notes } = body;

  if (!shopId || !employeeId || !startTime) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!serviceId) {
    return NextResponse.json(
      { error: 'A service must be selected before booking.' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // ── Service + shop_config in parallel ────────────────────────────────────
  const [{ data: service }, { data: shopConfig }] = await Promise.all([
    admin
      .from('services')
      .select('id, shop_id, name, duration_minutes, is_active')
      .eq('id', serviceId)
      .single(),
    admin
      .from('shop_config')
      .select('slot_interval_minutes, buffer_minutes')
      .eq('shop_id', shopId)
      .single(),
  ]);

  if (!service || service.shop_id !== shopId) {
    return NextResponse.json({ error: 'Service not found for this shop.' }, { status: 404 });
  }
  if (!service.is_active) {
    return NextResponse.json({ error: 'This service is not currently available.' }, { status: 400 });
  }

  const baseDuration         = service.duration_minutes;
  const slotIntervalMinutes  = shopConfig?.slot_interval_minutes ?? DEFAULT_SLOT_INTERVAL;
  const bufferMinutes        = shopConfig?.buffer_minutes        ?? DEFAULT_BUFFER;

  // Block any new booking if customer has an unresolved pending_reschedule at this shop
  const { data: pendingReschedule } = await admin
    .from('bookings')
    .select('id')
    .eq('customer_id', user.id)
    .eq('shop_id', shopId)
    .eq('status', 'pending_reschedule')
    .limit(1);

  if (pendingReschedule && pendingReschedule.length > 0) {
    return NextResponse.json(
      {
        error: 'You have an appointment at this shop that requires your attention. Please resolve it before booking again.',
        pendingBookingId: pendingReschedule[0].id,
      },
      { status: 400 }
    );
  }

  const startUtc = parseISO(startTime);
  if (isNaN(startUtc.getTime())) {
    return NextResponse.json({ error: 'Invalid startTime' }, { status: 400 });
  }

  let assignedEmployeeId: string;
  let assignedEmployeeName: string;
  let assignedEmployeeUserId: string | null;
  let effectiveDuration: number;
  let endUtc: Date;

  // ── Any-barber assignment ────────────────────────────────────────────────
  if (employeeId === 'any') {
    // Find all employees at the shop, ordered by name for stable selection.
    const { data: allEmployees } = await admin
      .from('employees')
      .select('id, name, user_id')
      .eq('shop_id', shopId)
      .order('name');

    if (!allEmployees || allEmployees.length === 0) {
      return NextResponse.json({ error: 'No barbers available at this shop.' }, { status: 404 });
    }

    const empIds = allEmployees.map((e) => e.id);

    // The slot's calendar date (shop-local) — used to filter TOR / overrides / schedule
    // We use the YYYY-MM-DD slice of startTime in UTC. For all reasonable timezones this
    // matches the shop-local day for slots in working hours; mismatch is handled because
    // we re-fetch the candidate's bookings via shop-local day bounds below.
    const dateStr = startTime.slice(0, 10);
    const dayOfWeek = new Date(`${dateStr}T12:00:00Z`).getUTCDay();

    const [
      { data: torRows },
      { data: overrideRows },
      { data: schedules },
      { data: empServiceRows },
    ] = await Promise.all([
      admin
        .from('time_off_requests')
        .select('employee_id')
        .in('employee_id', empIds)
        .eq('date', dateStr)
        .in('status', ['pending', 'approved']),
      admin
        .from('employee_schedule_overrides')
        .select('employee_id, is_working')
        .in('employee_id', empIds)
        .eq('date', dateStr),
      admin
        .from('employee_schedules')
        .select('employee_id, day_of_week, is_off')
        .in('employee_id', empIds)
        .eq('day_of_week', dayOfWeek),
      admin
        .from('employee_services')
        .select('employee_id, duration_minutes')
        .in('employee_id', empIds)
        .eq('service_id', serviceId),
    ]);

    const torBlocked  = new Set((torRows      ?? []).map((r) => r.employee_id as string));
    const overrideOff = new Set(
      (overrideRows ?? []).filter((o) => !o.is_working).map((o) => o.employee_id as string),
    );
    const overrideOn  = new Set(
      (overrideRows ?? []).filter((o) => o.is_working).map((o) => o.employee_id as string),
    );
    const scheduledOn = new Set(
      (schedules ?? [])
        .filter((s) => !s.is_off)
        .map((s) => s.employee_id as string),
    );

    // Candidate is eligible if not TOR-blocked, not override-off, and (override-on OR scheduled-on)
    const candidates = allEmployees.filter(
      (e) =>
        !torBlocked.has(e.id) &&
        !overrideOff.has(e.id) &&
        (overrideOn.has(e.id) || scheduledOn.has(e.id)),
    );

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: 'This slot is no longer available. Please choose another.' },
        { status: 409 }
      );
    }

    const overrideByEmp = new Map<string, number>();
    for (const row of empServiceRows ?? []) {
      if (row.duration_minutes != null) {
        overrideByEmp.set(row.employee_id as string, row.duration_minutes as number);
      }
    }

    // Pre-fetch bookings for all candidate IDs around startTime, then per-candidate
    // re-check conflict using their own effective duration.
    const winStart = addMinutes(startUtc, -8 * 60).toISOString();
    const winEnd   = addMinutes(startUtc,  8 * 60).toISOString();
    const { data: candidateBookings } = await admin
      .from('bookings')
      .select('employee_id, start_time, end_time, service_duration_minutes')
      .in('employee_id', candidates.map((c) => c.id))
      .in('status', ['confirmed', 'checked_in'])
      .gte('start_time', winStart)
      .lte('start_time', winEnd);

    const bookingsByEmp = new Map<string, CandidateBooking[]>();
    for (const b of candidateBookings ?? []) {
      const key = b.employee_id as string;
      if (!bookingsByEmp.has(key)) bookingsByEmp.set(key, []);
      bookingsByEmp.get(key)!.push({
        start_time:               b.start_time,
        end_time:                 b.end_time,
        service_duration_minutes: b.service_duration_minutes,
      });
    }

    let chosen: { id: string; name: string; user_id: string | null; duration: number; end: Date } | null = null;
    for (const cand of candidates) {
      const dur = overrideByEmp.get(cand.id) ?? baseDuration;
      const end = addMinutes(startUtc, blockedMinutes(dur, bufferMinutes, slotIntervalMinutes));
      const existing = bookingsByEmp.get(cand.id) ?? [];
      if (!hasConflict(startUtc, end, existing, bufferMinutes, slotIntervalMinutes)) {
        chosen = { id: cand.id, name: cand.name, user_id: cand.user_id, duration: dur, end };
        break;
      }
    }

    if (!chosen) {
      return NextResponse.json(
        { error: 'This slot is no longer available. Please choose another.' },
        { status: 409 }
      );
    }

    assignedEmployeeId     = chosen.id;
    assignedEmployeeName   = chosen.name;
    assignedEmployeeUserId = chosen.user_id;
    effectiveDuration      = chosen.duration;
    endUtc                 = chosen.end;
  } else {
    // ── Specific-barber path ───────────────────────────────────────────────
    const { data: employee } = await admin
      .from('employees')
      .select('id, name, user_id')
      .eq('id', employeeId)
      .eq('shop_id', shopId)
      .single();

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found in this shop' }, { status: 404 });
    }

    const { data: empOverride } = await admin
      .from('employee_services')
      .select('duration_minutes')
      .eq('employee_id', employee.id)
      .eq('service_id', serviceId)
      .maybeSingle();

    effectiveDuration = empOverride?.duration_minutes ?? baseDuration;
    endUtc            = addMinutes(startUtc, blockedMinutes(effectiveDuration, bufferMinutes, slotIntervalMinutes));

    // Duration-aware conflict check: pull this barber's bookings around startTime,
    // then test overlap using each booking's own blocked range.
    const winStart = addMinutes(startUtc, -8 * 60).toISOString();
    const winEnd   = addMinutes(startUtc,  8 * 60).toISOString();
    const { data: nearby } = await admin
      .from('bookings')
      .select('start_time, end_time, service_duration_minutes')
      .eq('employee_id', employee.id)
      .in('status', ['confirmed', 'checked_in'])
      .gte('start_time', winStart)
      .lte('start_time', winEnd);

    const conflict = hasConflict(
      startUtc,
      endUtc,
      (nearby ?? []) as CandidateBooking[],
      bufferMinutes,
      slotIntervalMinutes,
    );

    if (conflict) {
      return NextResponse.json(
        { error: 'This slot is no longer available. Please choose another.' },
        { status: 409 }
      );
    }

    assignedEmployeeId     = employee.id;
    assignedEmployeeName   = employee.name;
    assignedEmployeeUserId = employee.user_id;
  }

  const endTimeISO = endUtc.toISOString();

  // Server-side guard: reject past or malformed times.
  const timeError = validateFutureBooking(startTime, endTimeISO);
  if (timeError) {
    return NextResponse.json({ error: timeError }, { status: 422 });
  }

  // Customer + shop in parallel for the confirmation email
  const [{ data: customer }, { data: shop }] = await Promise.all([
    admin.from('profiles').select('full_name, email').eq('id', user.id).single(),
    admin.from('shops').select('name, timezone, owner_id, address, slug, deleted_at').eq('id', shopId).single(),
  ]);

  if ((shop as { deleted_at?: string | null } | null)?.deleted_at) {
    return NextResponse.json({ error: 'This shop is no longer accepting bookings.' }, { status: 400 });
  }

  const { data: booking, error: bookingError } = await admin
    .from('bookings')
    .insert({
      customer_id:              user.id,
      employee_id:              assignedEmployeeId,
      shop_id:                  shopId,
      start_time:               startTime,
      end_time:                 endTimeISO,
      status:                   'confirmed',
      notes:                    notes || null,
      service_id:               service.id,
      service_name:             service.name,
      service_duration_minutes: effectiveDuration,
    })
    .select()
    .single();

  if (bookingError) {
    if (bookingError.message.includes('no_double_booking')) {
      return NextResponse.json({ error: 'This slot is no longer available.' }, { status: 409 });
    }
    return NextResponse.json({ error: bookingError.message }, { status: 500 });
  }

  const emailData = {
    customerName:  customer?.full_name ?? 'Customer',
    customerEmail: customer?.email     ?? '',
    shopName:      shop?.name          ?? '',
    shopAddress:   shop?.address       ?? null,
    shopSlug:      shop?.slug          ?? '',
    barberName:    assignedEmployeeName,
    startTime,
    timezone:      shop?.timezone      ?? 'UTC',
    bookingId:     booking.id,
    notes:         notes || null,
    appUrl:        APP_URL,
  };

  if (emailData.customerEmail) {
    try {
      await sendBookingConfirmation(emailData);
    } catch (err) {
      console.error('[bookings POST] customer confirmation email failed:', err);
    }
  }

  if (assignedEmployeeUserId) {
    try {
      const { data: empProfile } = await admin
        .from('profiles')
        .select('email')
        .eq('id', assignedEmployeeUserId)
        .single();

      if (empProfile?.email) {
        await sendEmployeeNewBookingNotice({
          employeeEmail: empProfile.email,
          employeeName:  assignedEmployeeName,
          customerName:  emailData.customerName,
          shopName:      emailData.shopName,
          startTime,
          timezone:      emailData.timezone,
          bookingId:     booking.id,
          appUrl:        APP_URL,
        });
      }
    } catch (err) {
      console.error('[bookings POST] employee notification email failed:', err);
    }
  }

  if (shop?.owner_id) {
    try {
      const { data: ownerProfile } = await admin
        .from('profiles').select('email').eq('id', shop.owner_id as string).single();
      if (ownerProfile?.email) {
        await sendAdminNewBookingNotice({
          adminEmail:    ownerProfile.email,
          shopName:      emailData.shopName,
          shopAddress:   shop.address ?? null,
          customerName:  emailData.customerName,
          customerEmail: emailData.customerEmail,
          serviceName:   service.name,
          barberName:    assignedEmployeeName,
          startTime,
          timezone:      emailData.timezone,
          duration:      effectiveDuration,
          bookingId:     booking.id,
          appUrl:        APP_URL,
        });
      }
    } catch (err) {
      console.error('[bookings POST] admin new booking email failed:', err);
    }
  }

  if (shop?.owner_id) {
    await createNotification({
      shopId:      shopId,
      recipientId: shop.owner_id as string,
      type:        'new_booking',
      title:       'New Booking',
      body:        `${emailData.customerName} booked ${service.name} with ${assignedEmployeeName} on ${formatDateTimeInZone(startTime, (shop.timezone ?? 'UTC') as string)}`,
      bookingId:   booking.id,
    });
  }

  return NextResponse.json({ bookingId: booking.id }, { status: 201 });
}
