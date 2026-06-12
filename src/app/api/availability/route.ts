import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  generateSlotsForEmployee,
  DEFAULT_SLOT_INTERVAL,
  DEFAULT_BUFFER,
} from '@/lib/slot-generator';
import { addDays, format, parseISO } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import type { EmployeeScheduleOverride } from '@/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId     = searchParams.get('shopId');
  const serviceId  = searchParams.get('serviceId');
  const startDate  = searchParams.get('startDate');
  const endDate    = searchParams.get('endDate');
  const employeeId = searchParams.get('employeeId'); // optional; specific UUID = restrict to that barber

  if (!shopId || !serviceId || !startDate || !endDate) {
    return NextResponse.json(
      { error: 'Missing required params: shopId, serviceId, startDate, endDate' },
      { status: 400 }
    );
  }

  const supabase = createClient();

  const [{ data: shop }, { data: service }, { data: shopConfig }] = await Promise.all([
    supabase
      .from('shops')
      .select('timezone, default_open_time, default_close_time')
      .eq('id', shopId)
      .single(),
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

  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (!service || service.shop_id !== shopId) {
    return NextResponse.json({ error: 'Service not found for this shop' }, { status: 404 });
  }
  if (!service.is_active) {
    return NextResponse.json({ error: 'Service not active' }, { status: 400 });
  }

  const shopTz              = shop.timezone ?? 'UTC';
  const baseDuration        = service.duration_minutes;
  const slotIntervalMinutes = shopConfig?.slot_interval_minutes ?? DEFAULT_SLOT_INTERVAL;
  const bufferMinutes       = shopConfig?.buffer_minutes        ?? DEFAULT_BUFFER;

  // Build inclusive list of dates in range
  const start = parseISO(startDate);
  const end   = parseISO(endDate);
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(format(cursor, 'yyyy-MM-dd'));
    cursor = addDays(cursor, 1);
  }

  const dateMin = dates[0];
  const dateMax = dates[dates.length - 1];

  // "any" is treated the same as omitting employeeId.
  const restrictToEmployee = employeeId && employeeId !== 'any' ? employeeId : null;

  // Fetch employees — either just the one (specific barber) or the full roster.
  let employeesQuery = supabase
    .from('public_employees')
    .select('id, name')
    .eq('shop_id', shopId);
  if (restrictToEmployee) employeesQuery = employeesQuery.eq('id', restrictToEmployee);

  const { data: employees } = await employeesQuery;

  if (!employees || employees.length === 0) {
    return NextResponse.json({
      dates: Object.fromEntries(dates.map((d) => [d, false])),
    });
  }

  const empIds = employees.map((e) => e.id);

  const rangeStartUtc = fromZonedTime(`${dateMin}T00:00:00`,     shopTz).toISOString();
  const rangeEndUtc   = fromZonedTime(`${dateMax}T23:59:59.999`, shopTz).toISOString();

  const [
    { data: schedules },
    { data: overrides },
    { data: torRows },
    { data: specialHours },
    { data: empServices },
    { data: bookings },
  ] = await Promise.all([
    supabase
      .from('employee_schedules')
      .select('id, employee_id, day_of_week, start_time, end_time, is_off')
      .in('employee_id', empIds),
    supabase
      .from('employee_schedule_overrides')
      .select('id, employee_id, date, is_working, start_time, end_time')
      .in('employee_id', empIds)
      .gte('date', dateMin)
      .lte('date', dateMax),
    supabase
      .from('time_off_requests')
      .select('employee_id, date')
      .in('employee_id', empIds)
      .gte('date', dateMin)
      .lte('date', dateMax)
      .in('status', ['pending', 'approved']),
    supabase
      .from('shop_special_hours')
      .select('id, shop_id, date, is_closed, open_time, close_time')
      .eq('shop_id', shopId)
      .gte('date', dateMin)
      .lte('date', dateMax),
    supabase
      .from('employee_services')
      .select('employee_id, duration_minutes')
      .in('employee_id', empIds)
      .eq('service_id', serviceId),
    // When restricted to a specific barber, scope bookings to that barber too
    // so we don't load the whole shop's day. Otherwise load all (we need to
    // check every barber's conflicts for the "any" case).
    restrictToEmployee
      ? supabase
          .from('bookings')
          .select('start_time, end_time, employee_id, status, service_duration_minutes')
          .eq('employee_id', restrictToEmployee)
          .in('status', ['confirmed', 'checked_in'])
          .gte('start_time', rangeStartUtc)
          .lte('start_time', rangeEndUtc)
      : supabase
          .from('bookings')
          .select('start_time, end_time, employee_id, status, service_duration_minutes')
          .eq('shop_id', shopId)
          .in('status', ['confirmed', 'checked_in'])
          .gte('start_time', rangeStartUtc)
          .lte('start_time', rangeEndUtc),
  ]);

  const durationByEmp = new Map<string, number>();
  for (const r of empServices ?? []) {
    if (r.duration_minutes != null) {
      durationByEmp.set(r.employee_id as string, r.duration_minutes as number);
    }
  }

  const torSet = new Set<string>();
  for (const r of torRows ?? []) {
    torSet.add(`${r.employee_id}|${r.date}`);
  }

  const result: Record<string, boolean> = {};

  for (const date of dates) {
    let available = false;
    for (const emp of employees) {
      if (torSet.has(`${emp.id}|${date}`)) continue;
      const empDuration = durationByEmp.get(emp.id) ?? baseDuration;
      const slots = generateSlotsForEmployee({
        date,
        timezone:               shopTz,
        defaultOpenTime:        shop.default_open_time  ?? '09:00',
        defaultCloseTime:       shop.default_close_time ?? '18:00',
        schedules:              schedules    ?? [],
        overrides:              (overrides   ?? []) as unknown as EmployeeScheduleOverride[],
        specialHours:           specialHours ?? [],
        existingBookings:       bookings     ?? [],
        employee:               emp,
        serviceDurationMinutes: empDuration,
        slotIntervalMinutes,
        bufferMinutes,
      });
      if (slots.length > 0) {
        available = true;
        break;
      }
    }
    result[date] = available;
  }

  return NextResponse.json({ dates: result });
}
