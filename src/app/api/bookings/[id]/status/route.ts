import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { BookingStatus } from '@/types';

const THIRTY_MIN_MS  = 30 * 60 * 1000;
const TEN_MIN_MS     = 10 * 60 * 1000;

// Transitions available to BOTH employee and admin
const EMPLOYEE_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  confirmed:  ['checked_in', 'no_show'],
  checked_in: ['completed', 'no_show'],
};

// Additional transitions available to admin (shop owner) only
const ADMIN_ONLY_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  no_show:    ['confirmed'],   // undo within 10-minute window (Fix 4)
  checked_in: ['cancelled'],   // admin can cancel a checked_in booking (Fix 5)
};

// Terminal for employees — admins may still reverse no_show within 10 min
const EMPLOYEE_TERMINAL: BookingStatus[] = [
  'completed', 'no_show', 'cancelled', 'pending_reschedule',
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { status: newStatus }: { status: BookingStatus } = await request.json();
  const bookingId = params.id;

  const admin = createAdminClient();

  const { data: booking } = await admin
    .from('bookings')
    .select(`
      id, status, start_time, no_show_set_at,
      employee_id,
      employee:employees(id, user_id),
      shop:shops(id, owner_id)
    `)
    .eq('id', bookingId)
    .single();

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const employee = (booking.employee as unknown) as { id: string; user_id: string | null } | null;
  const shop     = (booking.shop     as unknown) as { id: string; owner_id: string } | null;

  const isAssignedEmployee = employee?.user_id === user.id;
  const isOwner            = shop?.owner_id     === user.id;

  if (!isAssignedEmployee && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const currentStatus = booking.status as BookingStatus;
  const now           = new Date();

  // ── Terminal-state guard (Fix 3d / Fix 4) ────────────────────────────────
  // Employees can never transition from terminal states.
  // Admins can only reverse no_show → confirmed within 10 minutes.
  if (EMPLOYEE_TERMINAL.includes(currentStatus)) {
    if (!isOwner) {
      return NextResponse.json(
        { error: `Cannot transition from '${currentStatus}'` },
        { status: 403 }
      );
    }
    // Admin path: only no_show → confirmed within 10 minutes is permitted
    if (!(currentStatus === 'no_show' && newStatus === 'confirmed')) {
      return NextResponse.json(
        { error: `Cannot transition from '${currentStatus}'` },
        { status: 422 }
      );
    }
    if (!booking.no_show_set_at || now.getTime() - new Date(booking.no_show_set_at).getTime() > TEN_MIN_MS) {
      return NextResponse.json(
        { error: 'The 10-minute undo window for this no-show has expired.' },
        { status: 422 }
      );
    }
    // Undo confirmed — clear no_show_set_at
    const { data: updated, error } = await admin
      .from('bookings')
      .update({ status: 'confirmed', no_show_set_at: null })
      .eq('id', bookingId)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(updated);
  }

  // ── Transition allowed? ───────────────────────────────────────────────────
  const employeeAllowed = EMPLOYEE_TRANSITIONS[currentStatus] ?? [];
  const adminAllowed    = isOwner ? (ADMIN_ONLY_TRANSITIONS[currentStatus] ?? []) : [];
  const allowed         = employeeAllowed.concat(adminAllowed).filter((v, i, a) => a.indexOf(v) === i);

  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      { error: `Transition from '${currentStatus}' to '${newStatus}' is not allowed` },
      { status: 422 }
    );
  }

  const startTime = new Date(booking.start_time);

  // Fix 3a: confirmed → checked_in only within 30 minutes of start
  if (currentStatus === 'confirmed' && newStatus === 'checked_in') {
    if (startTime.getTime() - now.getTime() > THIRTY_MIN_MS) {
      return NextResponse.json(
        { error: 'Check-in is only available within 30 minutes of the appointment time.' },
        { status: 400 }
      );
    }
  }

  // Fix 3b/3c: no_show (from confirmed or checked_in) only after start time
  if (newStatus === 'no_show') {
    if (startTime > now) {
      return NextResponse.json(
        { error: 'Cannot mark as no-show before the appointment start time.' },
        { status: 400 }
      );
    }
  }

  // Build the update payload
  const updatePayload: Record<string, unknown> = { status: newStatus };
  if (newStatus === 'no_show') {
    updatePayload.no_show_set_at = now.toISOString();
  }

  const { data: updated, error } = await admin
    .from('bookings')
    .update(updatePayload)
    .eq('id', bookingId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(updated);
}
