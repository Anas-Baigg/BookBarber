import { addMinutes, parseISO, isAfter, isBefore } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { Booking, Employee, EmployeeSchedule, EmployeeScheduleOverride, ShopSpecialHours, TimeSlot } from '@/types';

export const DEFAULT_SLOT_INTERVAL = 15; // minutes
export const DEFAULT_BUFFER        = 5;  // minutes
const MAX_SLOTS_PER_DAY            = 200;

// Backward compat: legacy bookings (created before service snapshot existed) have
// null service_duration_minutes. They blocked 25-minute fixed slots in the old
// algorithm. With the new (25 + 5 buffer) → ceil(30/15)*15 → 30 minutes blocked.
const LEGACY_SERVICE_DURATION = 25;

/**
 * PostgreSQL TIME columns are returned by PostgREST/Supabase as "HH:MM:SS".
 * Normalises any time string to exactly "HH:MM".
 */
function toHHMM(time: string): string {
  if (!time) return '00:00';
  const parts = time.split(':');
  const hh = parts[0].padStart(2, '0');
  const mm = (parts[1] ?? '00').padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * The full calendar block a booking occupies: ceil((service + buffer) / interval) * interval.
 * Always a multiple of the slot interval.
 */
export function blockedMinutes(
  serviceDurationMinutes: number,
  bufferMinutes: number,
  slotIntervalMinutes: number,
): number {
  return Math.ceil((serviceDurationMinutes + bufferMinutes) / slotIntervalMinutes) * slotIntervalMinutes;
}

type BookingForConflict = Pick<
  Booking,
  'start_time' | 'end_time' | 'employee_id' | 'status' | 'service_duration_minutes'
>;

interface GenerateSlotsOptions {
  date: string;                 // YYYY-MM-DD
  timezone: string;
  defaultOpenTime: string;      // HH:MM or HH:MM:SS
  defaultCloseTime: string;
  schedules: EmployeeSchedule[];
  overrides: EmployeeScheduleOverride[];
  specialHours: ShopSpecialHours[];
  existingBookings: BookingForConflict[];
  employee: Pick<Employee, 'id' | 'name'>;
  serviceDurationMinutes: number;
  slotIntervalMinutes?: number;
  bufferMinutes?: number;
  debug?: boolean;
}

function buildSlots(
  startUTC: Date,
  endUTC: Date,
  timezone: string,
  employee: Pick<Employee, 'id' | 'name'>,
  existingBookings: BookingForConflict[],
  serviceDurationMinutes: number,
  slotIntervalMinutes: number,
  bufferMinutes: number,
  log: (...args: unknown[]) => void,
): TimeSlot[] {
  const employeeBookings = existingBookings.filter(
    (b) =>
      b.employee_id === employee.id &&
      (b.status === 'confirmed' || b.status === 'checked_in'),
  );
  log(`existingBookings for this emp: ${employeeBookings.length}`);

  // Block size for the new slot being offered (constant for this run).
  const newSlotBlockedMin = blockedMinutes(serviceDurationMinutes, bufferMinutes, slotIntervalMinutes);
  const newSlotBlockedMs  = newSlotBlockedMin * 60 * 1000;

  // Precompute each existing booking's blocked range — duration-aware,
  // with legacy fallback for rows that predate the snapshot columns.
  const bookingRanges = employeeBookings.map((b) => {
    const start = parseISO(b.start_time);
    const dur   = b.service_duration_minutes ?? LEGACY_SERVICE_DURATION;
    const end   = addMinutes(start, blockedMinutes(dur, bufferMinutes, slotIntervalMinutes));
    return { start, end };
  });

  const slots: TimeSlot[] = [];
  let cursor = startUTC;
  let iterations = 0;

  // "Now" expressed in the shop's timezone so the past-slot boundary is
  // relative to the shop's clock — not the server's OS timezone or UTC.
  const nowInZone = toZonedTime(new Date(), timezone);

  while (iterations++ < MAX_SLOTS_PER_DAY) {
    const slotEnd = new Date(cursor.getTime() + newSlotBlockedMs);

    // The new slot must fit fully inside the working window.
    if (isAfter(slotEnd, endUTC)) break;

    const isBooked = bookingRanges.some(
      ({ start, end }) => isBefore(cursor, end) && isAfter(slotEnd, start),
    );

    const cursorInZone = toZonedTime(cursor, timezone);
    if (!isBooked && isAfter(cursorInZone, nowInZone)) {
      slots.push({
        start:        cursor.toISOString(),
        end:          slotEnd.toISOString(),
        employeeId:   employee.id,
        employeeName: employee.name,
      });
    }

    // Advance by one slot interval (NOT by the service duration).
    cursor = addMinutes(cursor, slotIntervalMinutes);
  }

  log(`generated ${slots.length} slots (${iterations - 1} iterations)`);
  return slots;
}

export function generateSlotsForEmployee(opts: GenerateSlotsOptions): TimeSlot[] {
  const {
    date,
    timezone,
    defaultOpenTime,
    defaultCloseTime,
    schedules,
    overrides,
    specialHours,
    existingBookings,
    employee,
    serviceDurationMinutes,
    slotIntervalMinutes = DEFAULT_SLOT_INTERVAL,
    bufferMinutes       = DEFAULT_BUFFER,
    debug               = false,
  } = opts;

  const log = (...args: unknown[]) => {
    if (debug) console.log(`[slots] emp=${employee.name} date=${date}`, ...args);
  };

  // Day-of-week in the shop's timezone. Using noon UTC keeps us in the right
  // calendar day for every UTC offset from -12 to +14.
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  log(`dayOfWeek=${dayOfWeek} timezone=${timezone}`);

  const special = specialHours.find((sh) => sh.date === date);
  if (special?.is_closed) {
    log('closed (special hours)');
    return [];
  }

  // ── Layer 2: date-specific employee override takes precedence ────────────
  const override = overrides.find(
    (o) => o.employee_id === employee.id && o.date === date,
  );
  if (override) {
    log(`override found is_working=${override.is_working}`);
    if (!override.is_working) return [];

    if (override.start_time && override.end_time) {
      const openTime  = toHHMM(override.start_time);
      const closeTime = toHHMM(override.end_time);
      log(`override times openTime=${openTime} closeTime=${closeTime}`);
      const startUTC = fromZonedTime(`${date}T${openTime}:00`,  timezone);
      const endUTC   = fromZonedTime(`${date}T${closeTime}:00`, timezone);
      if (isNaN(startUTC.getTime()) || isNaN(endUTC.getTime())) {
        console.error(`[slots] Invalid override date emp=${employee.name} date=${date}`);
        return [];
      }
      return buildSlots(
        startUTC, endUTC, timezone, employee,
        existingBookings, serviceDurationMinutes, slotIntervalMinutes, bufferMinutes, log,
      );
    }
    // is_working=true but no explicit times → fall through to base schedule
  }

  // ── Layer 1: base weekly schedule ────────────────────────────────────────
  const schedule = schedules.find(
    (s) => s.employee_id === employee.id && s.day_of_week === dayOfWeek,
  );

  if (!override?.is_working && (!schedule || schedule.is_off)) {
    log(`no schedule or off (schedules.length=${schedules.length})`);
    return [];
  }

  const openTime  = toHHMM(special?.open_time  ?? schedule?.start_time ?? defaultOpenTime);
  const closeTime = toHHMM(special?.close_time ?? schedule?.end_time   ?? defaultCloseTime);
  log(`openTime=${openTime} closeTime=${closeTime}`);

  const startUTC = fromZonedTime(`${date}T${openTime}:00`,  timezone);
  const endUTC   = fromZonedTime(`${date}T${closeTime}:00`, timezone);

  if (isNaN(startUTC.getTime()) || isNaN(endUTC.getTime())) {
    console.error(
      `[slots] Invalid date constructed for emp=${employee.name} date=${date} ` +
      `openTime=${openTime} closeTime=${closeTime} timezone=${timezone}`,
    );
    return [];
  }

  log(`startUTC=${startUTC.toISOString()} endUTC=${endUTC.toISOString()}`);
  return buildSlots(
    startUTC, endUTC, timezone, employee,
    existingBookings, serviceDurationMinutes, slotIntervalMinutes, bufferMinutes, log,
  );
}

/**
 * Per-employee effective duration carrier for the any-barber flow.
 * If `effectiveDuration` is omitted, the function-level `serviceDurationMinutes`
 * from `opts` is used as the fallback.
 */
export type EmployeeWithDuration = Pick<Employee, 'id' | 'name'> & {
  effectiveDuration?: number;
};

/**
 * Any-barber flow. Generates slots per-employee (each with their own effective
 * duration), then groups by start time. The `availableEmployees` field lists
 * every barber who can take that slot — useful for booking-time assignment.
 *
 * For UI compatibility the legacy `employeeId` / `employeeName` / `end` fields
 * are set from the first available barber at that start time (stable order:
 * the order of the input `employees` array).
 */
export function generateSlotsForAnyEmployee(
  employees: EmployeeWithDuration[],
  opts: Omit<GenerateSlotsOptions, 'employee'>,
): TimeSlot[] {
  const slotMap = new Map<string, TimeSlot>();

  for (const employee of employees) {
    const empDuration = employee.effectiveDuration ?? opts.serviceDurationMinutes;
    const slots = generateSlotsForEmployee({
      ...opts,
      employee,
      serviceDurationMinutes: empDuration,
    });

    for (const slot of slots) {
      const existing = slotMap.get(slot.start);
      if (existing) {
        existing.availableEmployees!.push({ id: employee.id, name: employee.name });
      } else {
        slotMap.set(slot.start, {
          start:              slot.start,
          end:                slot.end,
          employeeId:         employee.id,
          employeeName:       employee.name,
          availableEmployees: [{ id: employee.id, name: employee.name }],
        });
      }
    }
  }

  return Array.from(slotMap.values()).sort((a, b) => a.start.localeCompare(b.start));
}
