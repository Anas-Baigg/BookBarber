/**
 * Centralized booking-time business logic.
 *
 * This is the single source of truth for:
 *  - upcoming vs past classification
 *  - "today" boundaries in a given timezone
 *  - API-level future-booking validation
 *  - rescheduled booking handling
 *
 * Import from this file — never write inline `new Date()` comparisons
 * or `setHours(0,0,0,0)` in dashboards or API routes.
 */

import { parseISO } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';
import type { Booking } from '@/types';

type Classifiable = Pick<Booking, 'start_time' | 'status'>;

// ── Classification ────────────────────────────────────────────────────────────

/**
 * A booking is upcoming when:
 *  - Its start time is strictly in the future
 *  - AND it has not been cancelled
 *
 * Rescheduled bookings with a future start time remain upcoming.
 * The status 'rescheduled' reflects booking history, not operational state.
 */
export function isUpcoming(booking: Classifiable, now = new Date()): boolean {
  return parseISO(booking.start_time) > now && booking.status !== 'cancelled';
}

/**
 * A booking is past when:
 *  - Its start time is at or before now, OR
 *  - It was explicitly cancelled (regardless of time)
 *
 * Complement of isUpcoming — the union covers all bookings exactly once.
 */
export function isPast(booking: Classifiable, now = new Date()): boolean {
  return parseISO(booking.start_time) <= now || booking.status === 'cancelled';
}

// ── "Today" in a given timezone ───────────────────────────────────────────────

/**
 * Returns the UTC Date boundaries for "today" in the given IANA timezone.
 *
 * Never use `new Date().setHours(0,0,0,0)` — that produces server-local
 * midnight, which is wrong for shops in any timezone other than the server's.
 *
 * Example (shop in America/New_York, server in UTC):
 *   today in NY starts at 04:00 UTC (UTC-4 in summer)
 *   today in NY ends   at 03:59:59.999 UTC the following day
 */
export function getTodayBoundsUTC(timezone: string): { start: Date; end: Date } {
  const nowInZone = toZonedTime(new Date(), timezone);
  const dateStr = format(nowInZone, 'yyyy-MM-dd'); // YYYY-MM-DD in shop's local date

  return {
    start: fromZonedTime(`${dateStr}T00:00:00`, timezone),
    end:   fromZonedTime(`${dateStr}T23:59:59.999`, timezone),
  };
}

/**
 * Returns true if the UTC timestamp falls within today's calendar day
 * in the given timezone.
 */
export function isTodayInZone(isoTime: string, timezone: string): boolean {
  const { start, end } = getTodayBoundsUTC(timezone);
  const t = parseISO(isoTime);
  return t >= start && t <= end;
}

/**
 * Returns true if the UTC timestamp is strictly in the future
 * after today ends in the given timezone (i.e., tomorrow or later).
 */
export function isAfterTodayInZone(isoTime: string, timezone: string): boolean {
  const { end } = getTodayBoundsUTC(timezone);
  return parseISO(isoTime) > end;
}

// ── API-level booking validation ──────────────────────────────────────────────

/**
 * Validates that a booking's times are sane and in the future.
 *
 * Call this in booking-creation AND reschedule API routes BEFORE writing
 * to the database. The slot generator hides past slots on the frontend,
 * but backend validation is the authoritative guard against:
 *   - stale confirm screens (user waited too long)
 *   - direct API calls with expired timestamps
 *   - clock-skew edge cases
 *
 * Returns an error string if invalid, null if valid.
 *
 * Grace period (default 2 min): allows confirmation of a slot whose start
 * time is up to 2 minutes in the past — handles the case where the user
 * was on the confirm screen as the slot window opened.
 */
export function validateFutureBooking(
  startTime: string,
  endTime: string,
  gracePeriodMs = 2 * 60 * 1000
): string | null {
  const start = parseISO(startTime);
  const end   = parseISO(endTime);

  if (isNaN(start.getTime())) return 'Invalid start time format';
  if (isNaN(end.getTime()))   return 'Invalid end time format';

  const cutoff = new Date(Date.now() - gracePeriodMs);

  if (start <= cutoff) {
    return 'This time slot has already passed. Please select a future slot.';
  }
  if (end <= start) {
    return 'End time must be after start time';
  }

  return null;
}
