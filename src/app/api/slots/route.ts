import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateSlotsForEmployee,
  generateSlotsForAnyEmployee,
  DEFAULT_SLOT_INTERVAL,
  DEFAULT_BUFFER,
  type EmployeeWithDuration,
} from '@/lib/slot-generator';
import { addDays, format } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const DEBUG = process.env.NODE_ENV !== 'production';

function log(...args: unknown[]) {
  if (DEBUG) console.log('[/api/slots]', ...args);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId     = searchParams.get('shopId');
  const employeeId = searchParams.get('employeeId');
  const date       = searchParams.get('date');
  const serviceId  = searchParams.get('serviceId');

  log(`shopId=${shopId} employeeId=${employeeId} date=${date} serviceId=${serviceId}`);

  if (!shopId || !employeeId || !date) {
    return NextResponse.json(
      { error: 'Missing required params: shopId, employeeId, date' },
      { status: 400 }
    );
  }

  if (!serviceId) {
    return NextResponse.json(
      { error: 'A service must be selected before viewing available times.' },
      { status: 400 }
    );
  }

  const supabase = createClient();

  const t0 = Date.now();
  const { data: shop, error: shopErr } = await supabase
    .from('public_shops')
    .select('timezone, default_open_time, default_close_time')
    .eq('id', shopId)
    .single();

  log(`shop query ${Date.now() - t0}ms`, shop ?? shopErr?.message);

  if (!shop) {
    // Return empty slot list for soft-deleted shops; 404 only for truly absent shops
    const adminClient = createAdminClient();
    const { data: deletedShop } = await adminClient
      .from('shops')
      .select('id')
      .eq('id', shopId)
      .not('deleted_at', 'is', null)
      .maybeSingle();
    if (deletedShop) return NextResponse.json([]);
    return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  }

  // ── Service + shop_config ────────────────────────────────────────────────
  const [{ data: service }, { data: shopConfig }] = await Promise.all([
    supabase
      .from('services')
      .select('id, shop_id, duration_minutes, is_active')
      .eq('id', serviceId)
      .single(),
    supabase
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

  const baseDuration       = service.duration_minutes;
  const slotIntervalMinutes = shopConfig?.slot_interval_minutes ?? DEFAULT_SLOT_INTERVAL;
  const bufferMinutes       = shopConfig?.buffer_minutes        ?? DEFAULT_BUFFER;

  const { data: specialHours } = await supabase
    .from('shop_special_hours')
    .select('id, shop_id, date, is_closed, open_time, close_time')
    .eq('shop_id', shopId)
    .eq('date', date);

  const shopTz = shop.timezone ?? 'UTC';

  // Bug 6: reject dates beyond the 14-day booking window
  const maxDateStr = format(addDays(toZonedTime(new Date(), shopTz), 13), 'yyyy-MM-dd');
  if (date > maxDateStr) {
    return NextResponse.json(
      { error: 'Bookings are only available within the next 14 days.' },
      { status: 400 }
    );
  }

  const dayStart = fromZonedTime(`${date}T00:00:00`,     shopTz).toISOString();
  const dayEnd   = fromZonedTime(`${date}T23:59:59.999`, shopTz).toISOString();

  const { data: existingBookings } = await supabase
    .from('bookings')
    .select('start_time, end_time, employee_id, status, service_duration_minutes')
    .eq('shop_id', shopId)
    .in('status', ['confirmed', 'checked_in'])
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd);

  const commonOpts = {
    date,
    timezone:         shopTz,
    defaultOpenTime:  shop.default_open_time  ?? '09:00',
    defaultCloseTime: shop.default_close_time ?? '18:00',
    specialHours:     specialHours ?? [],
    existingBookings: existingBookings ?? [],
    slotIntervalMinutes,
    bufferMinutes,
    debug:            DEBUG,
  };

  // ── Any employee ──────────────────────────────────────────────────────────
  if (employeeId === 'any') {
    const { data: employees } = await supabase
      .from('public_employees')
      .select('id, name')
      .eq('shop_id', shopId);

    if (!employees || employees.length === 0) {
      log('no employees — returning []');
      return NextResponse.json([]);
    }

    const empIds = employees.map((e) => e.id);

    const [{ data: schedules }, { data: overrides }, { data: empServiceRows }] = await Promise.all([
      supabase
        .from('employee_schedules')
        .select('id, employee_id, day_of_week, start_time, end_time, is_off')
        .in('employee_id', empIds),
      supabase
        .from('public_schedule_overrides')
        .select('id, employee_id, date, is_working, start_time, end_time')
        .in('employee_id', empIds)
        .eq('date', date),
      supabase
        .from('employee_services')
        .select('employee_id, duration_minutes')
        .in('employee_id', empIds)
        .eq('service_id', serviceId),
    ]);

    // Exclude barbers with pending/approved TOR or day-off override BEFORE generating
    const { data: torRows } = await supabase
      .from('time_off_requests')
      .select('employee_id')
      .in('employee_id', empIds)
      .eq('date', date)
      .in('status', ['pending', 'approved']);

    const torBlocked  = new Set((torRows ?? []).map((r) => r.employee_id as string));
    const overrideOff = new Set(
      (overrides ?? []).filter((o) => !o.is_working).map((o) => o.employee_id as string)
    );

    const eligibleEmployees = employees.filter(
      (e) => !torBlocked.has(e.id) && !overrideOff.has(e.id)
    );

    log(`eligible employees after TOR/override filter: ${eligibleEmployees.length} of ${employees.length}`);

    if (eligibleEmployees.length === 0) {
      return NextResponse.json([]);
    }

    // Per-employee effective duration: override (if any) or service base
    const overrideByEmp = new Map<string, number>();
    for (const row of empServiceRows ?? []) {
      if (row.duration_minutes != null) {
        overrideByEmp.set(row.employee_id as string, row.duration_minutes as number);
      }
    }

    const employeesWithDuration: EmployeeWithDuration[] = eligibleEmployees.map((e) => ({
      id:                 e.id,
      name:               e.name,
      effectiveDuration:  overrideByEmp.get(e.id) ?? baseDuration,
    }));

    const slots = generateSlotsForAnyEmployee(employeesWithDuration, {
      ...commonOpts,
      schedules: schedules ?? [],
      overrides: (overrides ?? []).filter((o) =>
        eligibleEmployees.some((e) => e.id === o.employee_id)
      ) as unknown as import('@/types').EmployeeScheduleOverride[],
      serviceDurationMinutes: baseDuration,
    });

    log(`returning ${slots.length} slots`);
    return NextResponse.json(slots);
  }

  // ── Specific employee ─────────────────────────────────────────────────────

  // Block slots for employees with pending/approved TOR on this date
  const { data: torCheck } = await supabase
    .from('time_off_requests')
    .select('id, status')
    .eq('employee_id', employeeId)
    .eq('date', date)
    .in('status', ['pending', 'approved'])
    .limit(1);

  if (torCheck && torCheck.length > 0) {
    log(`employee ${employeeId} has ${torCheck[0].status} TOR on ${date} — returning []`);
    return NextResponse.json([]);
  }

  const { data: employee } = await supabase
    .from('public_employees')
    .select('id, name')
    .eq('id', employeeId)
    .eq('shop_id', shopId)
    .single();

  if (!employee) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }

  const [{ data: schedules }, { data: overrides }, { data: empOverride }] = await Promise.all([
    supabase
      .from('employee_schedules')
      .select('id, employee_id, day_of_week, start_time, end_time, is_off')
      .eq('employee_id', employeeId),
    supabase
      .from('public_schedule_overrides')
      .select('id, employee_id, date, is_working, start_time, end_time')
      .eq('employee_id', employeeId)
      .eq('date', date),
    supabase
      .from('employee_services')
      .select('duration_minutes')
      .eq('employee_id', employeeId)
      .eq('service_id', serviceId)
      .maybeSingle(),
  ]);

  const effectiveDuration = empOverride?.duration_minutes ?? baseDuration;

  const slots = generateSlotsForEmployee({
    ...commonOpts,
    schedules: schedules ?? [],
    overrides: (overrides ?? []) as unknown as import('@/types').EmployeeScheduleOverride[],
    employee,
    serviceDurationMinutes: effectiveDuration,
  });

  log(`returning ${slots.length} slots`);
  return NextResponse.json(slots);
}
