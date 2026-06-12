/**
 * Shared utility for finding available replacement barbers (Fix 7).
 *
 * Exclusion rules applied before the slot generator runs:
 *   1. Barber has a pending or approved time_off_requests row for that date
 *   2. Barber has an employee_schedule_overrides row with is_working = false for that date
 *   3. Barber is not scheduled to work that day (base weekly schedule)
 *   4. Slot generator confirms the barber actually has a free slot at the exact time
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { generateSlotsForEmployee } from '@/lib/slot-generator';

export interface ReplacementBarber {
  id:   string;
  name: string;
}

/**
 * For each entry in `bookings`, return the list of barbers at `shopId` who can
 * take that exact slot on `date`. Results are keyed by booking ID.
 *
 * All DB queries are batched into a single parallel round-trip before the slot
 * generator runs per candidate — the exclusion happens before generation, not after.
 */
export async function getAvailableReplacements({
  shopId,
  excludeEmployeeId,
  date,
  bookings,
  shopTimezone,
  defaultOpenTime,
  defaultCloseTime,
}: {
  shopId:             string;
  excludeEmployeeId:  string;
  date:               string;    // YYYY-MM-DD shop-local
  bookings:           Array<{
    bookingId:                string;
    startUtc:                 string;
    endUtc:                   string;
    serviceDurationMinutes?:  number | null;
  }>;
  shopTimezone:       string;
  defaultOpenTime:    string;
  defaultCloseTime:   string;
}): Promise<Record<string, ReplacementBarber[]>> {
  if (bookings.length === 0) return {};

  const admin = createAdminClient();

  // 1. All employees at this shop except the original barber
  const { data: allEmployees } = await admin
    .from('employees')
    .select('id, name')
    .eq('shop_id', shopId)
    .neq('id', excludeEmployeeId);

  if (!allEmployees || allEmployees.length === 0) {
    return Object.fromEntries(bookings.map((b) => [b.bookingId, []]));
  }

  const empIds = allEmployees.map((e) => e.id);

  // 2. Batch queries: TOR, overrides, schedules, special hours, existing bookings
  const shopTz = shopTimezone ?? 'UTC';
  const [
    { data: torRows },
    { data: overrideRows },
    { data: schedules },
    { data: specialHours },
    { data: existingBookings },
  ] = await Promise.all([
    admin
      .from('time_off_requests')
      .select('employee_id')
      .in('employee_id', empIds)
      .eq('date', date)
      .in('status', ['pending', 'approved']),

    admin
      .from('employee_schedule_overrides')
      .select('*')
      .in('employee_id', empIds)
      .eq('date', date),

    admin
      .from('employee_schedules')
      .select('*')
      .in('employee_id', empIds),

    admin
      .from('shop_special_hours')
      .select('*')
      .eq('shop_id', shopId)
      .eq('date', date),

    admin
      .from('bookings')
      .select('start_time, end_time, employee_id, status, service_duration_minutes')
      .eq('shop_id', shopId)
      .eq('status', 'confirmed')
      .gte('start_time', `${date}T00:00:00.000Z`)
      .lte('start_time', `${date}T23:59:59.999Z`),
  ]);

  // 3. Build exclusion sets
  const torBlocked = new Set((torRows ?? []).map((r) => r.employee_id as string));
  const overrideOff = new Set(
    (overrideRows ?? [])
      .filter((o) => !o.is_working)
      .map((o) => o.employee_id as string)
  );

  const candidates = allEmployees.filter(
    (e) => !torBlocked.has(e.id) && !overrideOff.has(e.id)
  );

  // 4. For each candidate × booking, run the slot generator with that booking's
  //    own service duration and check whether the wanted start is offered.
  //    Legacy bookings (null service_duration_minutes) fall back to 25 min.
  const result: Record<string, ReplacementBarber[]> = Object.fromEntries(
    bookings.map((b) => [b.bookingId, []])
  );

  for (const emp of candidates) {
    const empSchedules = (schedules    ?? []).filter((s) => s.employee_id === emp.id);
    const empOverrides = (overrideRows ?? []).filter((o) => o.employee_id === emp.id);

    for (const booking of bookings) {
      const slots = generateSlotsForEmployee({
        date,
        timezone:               shopTz,
        defaultOpenTime,
        defaultCloseTime,
        schedules:              empSchedules,
        overrides:              empOverrides,
        specialHours:           specialHours     ?? [],
        existingBookings:       existingBookings ?? [],
        employee:               emp,
        serviceDurationMinutes: booking.serviceDurationMinutes ?? 25,
      });

      if (slots.some((s) => s.start === booking.startUtc)) {
        result[booking.bookingId].push({ id: emp.id, name: emp.name });
      }
    }
  }

  return result;
}
