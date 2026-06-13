import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateFutureBooking } from '@/lib/booking-time';
import { addMinutes, parseISO } from 'date-fns';
import { blockedMinutes, DEFAULT_SLOT_INTERVAL, DEFAULT_BUFFER } from '@/lib/slot-generator';
import {
  sendBookingCancellation,
  sendBookingRescheduled,
  sendAdminCancellationNotice,
  sendAdminRescheduledNotice,
  sendEmployeeBookingCancelled,
  sendEmployeeNewBookingNotice,
} from '@/lib/emails';
import { createNotification } from '@/lib/notifications';
import { formatDateTimeInZone } from '@/lib/utils';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

const LEGACY_SERVICE_DURATION = 25;

type RescheduleBooking = {
  start_time: string;
  end_time: string;
  service_duration_minutes: number | null;
};

function hasRescheduleConflict(
  start: Date,
  end: Date,
  existing: RescheduleBooking[],
  bufferMin: number,
  slotInterval: number,
): boolean {
  return existing.some((b) => {
    const bStart = parseISO(b.start_time);
    const dur    = b.service_duration_minutes ?? LEGACY_SERVICE_DURATION;
    const bEnd   = addMinutes(bStart, blockedMinutes(dur, bufferMin, slotInterval));
    return start < bEnd && end > bStart;
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { action, startTime } = body;
  const bookingId = params.id;

  const admin = createAdminClient();

  const { data: booking } = await admin
    .from('bookings')
    .select(`
      *,
      employee:employees(id, name, user_id),
      shop:shops(id, name, timezone, owner_id, address, slug),
      customer:profiles!bookings_customer_id_fkey(id, full_name, email)
    `)
    .eq('id', bookingId)
    .single();

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const isCustomer         = booking.customer_id === user.id;
  const isOwner            = booking.shop?.owner_id === user.id;
  const empRecord          = booking.employee as { id?: string; user_id?: string | null } | null;
  const isAssignedEmployee = !!empRecord?.user_id && empRecord.user_id === user.id;
  if (!isCustomer && !isOwner && !isAssignedEmployee) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: adminProfile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', booking.shop?.owner_id)
    .single();

  const emailBase = {
    customerName:  booking.customer?.full_name ?? 'Customer',
    customerEmail: booking.customer?.email     ?? '',
    shopName:      booking.shop?.name          ?? '',
    shopAddress:   (booking.shop as unknown as { address?: string | null })?.address ?? null,
    shopSlug:      (booking.shop as unknown as { slug?: string })?.slug ?? '',
    barberName:    booking.employee?.name      ?? '',
    startTime:     booking.start_time,
    timezone:      booking.shop?.timezone      ?? 'UTC',
    bookingId,
    appUrl: APP_URL,
  };

  // Helper: send cancellation notice to the assigned employee
  async function notifyEmployeeCancelled(reason: string) {
    const emp = booking.employee as { user_id?: string | null; name?: string } | null;
    if (!emp?.user_id) return;
    try {
      const { data: empProfile } = await admin
        .from('profiles').select('email').eq('id', emp.user_id).single();
      if (empProfile?.email) {
        await sendEmployeeBookingCancelled({
          employeeEmail: empProfile.email,
          employeeName:  emp.name ?? '',
          customerName:  emailBase.customerName,
          startTime:     emailBase.startTime,
          timezone:      emailBase.timezone,
          shopName:      emailBase.shopName,
          reason,
          appUrl:        APP_URL,
        });
      }
    } catch (err) {
      console.error('[bookings PATCH] employee cancel notify failed:', err);
    }
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    // Bug 3: admin may also cancel checked_in; customers may also cancel pending_reschedule (Fix 1)
    const cancellable = isOwner
      ? ['confirmed', 'rescheduled', 'checked_in']
      : isAssignedEmployee
      ? ['confirmed']
      : ['confirmed', 'rescheduled', 'pending_reschedule'];
    if (!cancellable.includes(booking.status as string)) {
      return NextResponse.json(
        { error: 'This booking cannot be cancelled in its current state.' },
        { status: 400 }
      );
    }

    // Fix 6: flag bookings that transition out of pending_reschedule into cancelled
    const cancelUpdate: Record<string, unknown> = { status: 'cancelled' };
    if ((booking.status as string) === 'pending_reschedule') {
      cancelUpdate.was_pending_reschedule = true;
    }

    const { error } = await admin
      .from('bookings')
      .update(cancelUpdate)
      .eq('id', bookingId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (emailBase.customerEmail) {
      try {
        await sendBookingCancellation({ ...emailBase, cancelledBy: isCustomer ? 'customer' : 'shop' });
      } catch (err) {
        console.error('[bookings PATCH cancel] customer email failed:', err);
      }
    }

    if ((isCustomer || isAssignedEmployee) && adminProfile?.email) {
      try {
        await sendAdminCancellationNotice({ adminEmail: adminProfile.email, ...emailBase });
      } catch (err) {
        console.error('[bookings PATCH cancel] admin notice email failed:', err);
      }
    }

    // Skip employee notification when the employee is the one cancelling
    const cancelReason = isCustomer ? 'Cancelled by customer' : 'Cancelled by shop';
    if (!isAssignedEmployee) {
      await notifyEmployeeCancelled(cancelReason);
    }

    if ((isCustomer || isAssignedEmployee) && booking.shop?.owner_id) {
      const shopInfo = booking.shop as unknown as { id: string; owner_id: string; timezone: string } | null;
      await createNotification({
        shopId:      booking.shop_id as string,
        recipientId: shopInfo?.owner_id ?? '',
        type:        'booking_cancelled',
        title:       'Booking Cancelled',
        body:        `${emailBase.customerName} cancelled their ${(booking.service_name as string | null) ?? 'appointment'} on ${formatDateTimeInZone(booking.start_time, shopInfo?.timezone ?? 'UTC')}`,
        bookingId:   booking.id,
      });
    }

    // Notify the assigned employee — skip when the employee is the one cancelling
    if (!isAssignedEmployee) {
      const empUserId = empRecord?.user_id;
      const empId     = empRecord?.id;
      if (empUserId) {
        await createNotification({
          shopId:      booking.shop_id as string,
          recipientId: empUserId,
          type:        'booking_cancelled',
          title:       'Booking Cancelled',
          body:        `${emailBase.customerName}'s ${(booking.service_name as string | null) ?? 'appointment'} on ${formatDateTimeInZone(booking.start_time, emailBase.timezone)} was cancelled`,
          bookingId:   booking.id,
          employeeId:  empId,
        });
      }
    }

    return NextResponse.json({ status: 'cancelled' });
  }

  // ── Reschedule ────────────────────────────────────────────────────────────
  if (action === 'reschedule') {
    // Admins may also reschedule a checked_in booking; customers may not.
    const rescheduleableByCustomer = ['confirmed', 'rescheduled', 'pending_reschedule'];
    const rescheduleableByAdmin    = [...rescheduleableByCustomer, 'checked_in'];
    const allowedStatuses = isOwner ? rescheduleableByAdmin : rescheduleableByCustomer;

    if (!allowedStatuses.includes(booking.status as string)) {
      return NextResponse.json(
        { error: 'This booking cannot be rescheduled in its current state.' },
        { status: 400 }
      );
    }

    if (!startTime) {
      return NextResponse.json({ error: 'startTime is required' }, { status: 400 });
    }

    // Fix 1: compute endTime server-side — client-provided value is ignored entirely.
    // Use the booking's stored service duration (legacy fallback for old rows without service snapshot).
    const { data: shopConfig } = await admin
      .from('shop_config')
      .select('slot_interval_minutes, buffer_minutes')
      .eq('shop_id', booking.shop_id)
      .single();

    const slotInterval    = shopConfig?.slot_interval_minutes ?? DEFAULT_SLOT_INTERVAL;
    const bufferMin       = shopConfig?.buffer_minutes        ?? DEFAULT_BUFFER;
    const effectiveDur    = (booking.service_duration_minutes as number | null) ?? LEGACY_SERVICE_DURATION;
    const computedEndTime = addMinutes(
      parseISO(startTime),
      blockedMinutes(effectiveDur, bufferMin, slotInterval),
    ).toISOString();

    const timeError = validateFutureBooking(startTime, computedEndTime);
    if (timeError) {
      return NextResponse.json({ error: timeError }, { status: 422 });
    }

    const oldStartTime         = booking.start_time;
    const wasPendingReschedule = booking.status === 'pending_reschedule';
    const originalEmployeeId   = booking.employee_id;
    const newEmployeeId        = body.newEmployeeId ?? null;

    // Fix 2: verify newEmployeeId belongs to the same shop as the booking.
    // Combines the ownership check with the name fetch to save a round-trip.
    let newBarberName: string | undefined;
    let newBarberUserId: string | null | undefined;
    if (newEmployeeId) {
      const { data: targetEmp } = await admin
        .from('employees')
        .select('shop_id, name, user_id')
        .eq('id', newEmployeeId)
        .single();
      if (!targetEmp || targetEmp.shop_id !== booking.shop_id) {
        return NextResponse.json(
          { error: 'The selected barber is not available at this shop.' },
          { status: 400 }
        );
      }
      newBarberName   = targetEmp.name;
      newBarberUserId = targetEmp.user_id;
    }

    // Fix 3: duration-aware conflict check.
    // Fetches nearby bookings for the target employee (excluding this booking via neq),
    // then tests overlap using each booking's own blocked range — not raw stored end_time.
    const targetEmployeeId = newEmployeeId ?? originalEmployeeId;
    const newStartUtc      = parseISO(startTime);
    const newEndUtc        = parseISO(computedEndTime);
    const winStart         = addMinutes(newStartUtc, -8 * 60).toISOString();
    const winEnd           = addMinutes(newStartUtc,  8 * 60).toISOString();

    const { data: nearbyBookings } = await admin
      .from('bookings')
      .select('start_time, end_time, service_duration_minutes')
      .eq('employee_id', targetEmployeeId)
      .in('status', ['confirmed', 'checked_in'])
      .neq('id', bookingId)
      .gte('start_time', winStart)
      .lte('start_time', winEnd);

    if (hasRescheduleConflict(
      newStartUtc,
      newEndUtc,
      (nearbyBookings ?? []) as RescheduleBooking[],
      bufferMin,
      slotInterval,
    )) {
      return NextResponse.json({ error: 'The selected slot is not available.' }, { status: 409 });
    }

    const { data: updated, error } = await admin
      .from('bookings')
      .update({
        start_time:          startTime,
        end_time:            computedEndTime,
        status:              'rescheduled',
        reschedule_deadline: null,
        ...(newEmployeeId ? { employee_id: newEmployeeId } : {}),
      })
      .eq('id', bookingId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (emailBase.customerEmail) {
      try {
        await sendBookingRescheduled({ ...emailBase, newStartTime: startTime, newBarberName });
      } catch (err) {
        console.error('[bookings PATCH reschedule] customer email failed:', err);
      }
    }

    if (isCustomer && adminProfile?.email) {
      try {
        await sendAdminRescheduledNotice({
          adminEmail:   adminProfile.email,
          shopName:     emailBase.shopName,
          customerName: emailBase.customerName,
          barberName:   emailBase.barberName,
          oldStartTime,
          newStartTime: startTime,
          timezone:     emailBase.timezone,
          bookingId,
          appUrl:       APP_URL,
        });
      } catch (err) {
        console.error('[bookings PATCH reschedule] admin notice email failed:', err);
      }
    }

    // Section 5: when rescheduling from pending_reschedule, notify both employees
    if (wasPendingReschedule && isCustomer) {
      const resolvedNewEmployeeId = newEmployeeId ?? originalEmployeeId;

      // Notify original employee their slot was freed (only if different from new)
      if (newEmployeeId && newEmployeeId !== originalEmployeeId) {
        const origEmp = booking.employee as { user_id?: string | null; name?: string } | null;
        if (origEmp?.user_id) {
          try {
            const { data: origProfile } = await admin
              .from('profiles').select('email').eq('id', origEmp.user_id).single();
            if (origProfile?.email) {
              await sendEmployeeBookingCancelled({
                employeeEmail: origProfile.email,
                employeeName:  origEmp.name ?? '',
                customerName:  emailBase.customerName,
                startTime:     oldStartTime,
                timezone:      emailBase.timezone,
                shopName:      emailBase.shopName,
                reason:        'Customer rescheduled to a different barber',
                appUrl:        APP_URL,
              });
            }
          } catch (err) {
            console.error('[bookings PATCH reschedule] orig employee notify failed:', err);
          }
        }
      }

      // Notify the new (or same) employee of the confirmed booking
      if (resolvedNewEmployeeId) {
        try {
          const { data: newEmpRecord } = await admin
            .from('employees').select('id, name, user_id').eq('id', resolvedNewEmployeeId).single();
          if (newEmpRecord?.user_id) {
            const { data: newEmpProfile } = await admin
              .from('profiles').select('email').eq('id', newEmpRecord.user_id).single();
            if (newEmpProfile?.email) {
              await sendEmployeeNewBookingNotice({
                employeeEmail: newEmpProfile.email,
                employeeName:  newEmpRecord.name,
                customerName:  emailBase.customerName,
                shopName:      emailBase.shopName,
                startTime,
                timezone:      emailBase.timezone,
                bookingId,
                appUrl:        APP_URL,
              });
            }
          }
        } catch (err) {
          console.error('[bookings PATCH reschedule] new employee notify failed:', err);
        }
      }
    }

    // Admin-initiated reschedule: notify affected employees.
    // Distinct from the pending_reschedule+customer path above — that path handles
    // the sick-call flow where both employees are involved. This path handles the
    // case where an admin directly moves an appointment (status can be anything in
    // rescheduleableByAdmin).
    if (isOwner) {
      // If barber changed: tell the original barber their booking was moved away
      if (newEmployeeId && newEmployeeId !== originalEmployeeId) {
        const origEmp = booking.employee as { user_id?: string | null; name?: string } | null;
        if (origEmp?.user_id) {
          try {
            const { data: origProfile } = await admin
              .from('profiles').select('email').eq('id', origEmp.user_id).single();
            if (origProfile?.email) {
              await sendEmployeeBookingCancelled({
                employeeEmail: origProfile.email,
                employeeName:  origEmp.name ?? '',
                customerName:  emailBase.customerName,
                startTime:     oldStartTime,
                timezone:      emailBase.timezone,
                shopName:      emailBase.shopName,
                reason:        'Booking rescheduled by admin',
                appUrl:        APP_URL,
              });
            }
          } catch (err) {
            console.error('[bookings PATCH reschedule] orig employee (admin) notify failed:', err);
          }
        }
      }

      // Notify the assigned barber (new or unchanged) about the updated appointment
      const resolvedNewEmpId = newEmployeeId ?? originalEmployeeId;
      if (resolvedNewEmpId) {
        try {
          const { data: newEmpRecord } = await admin
            .from('employees').select('id, name, user_id').eq('id', resolvedNewEmpId).single();
          if (newEmpRecord?.user_id) {
            const { data: newEmpProfile } = await admin
              .from('profiles').select('email').eq('id', newEmpRecord.user_id).single();
            if (newEmpProfile?.email) {
              await sendEmployeeNewBookingNotice({
                employeeEmail: newEmpProfile.email,
                employeeName:  newEmpRecord.name,
                customerName:  emailBase.customerName,
                shopName:      emailBase.shopName,
                startTime,
                timezone:      emailBase.timezone,
                bookingId,
                appUrl:        APP_URL,
              });
            }
          }
        } catch (err) {
          console.error('[bookings PATCH reschedule] new employee (admin) notify failed:', err);
        }
      }
    }

    if (isCustomer && booking.shop?.owner_id) {
      const shopInfo = booking.shop as unknown as { id: string; owner_id: string; timezone: string } | null;
      await createNotification({
        shopId:      booking.shop_id as string,
        recipientId: shopInfo?.owner_id ?? '',
        type:        'booking_rescheduled',
        title:       'Booking Rescheduled',
        body:        `${emailBase.customerName} rescheduled their ${(booking.service_name as string | null) ?? 'appointment'} to ${formatDateTimeInZone(startTime, shopInfo?.timezone ?? 'UTC')}`,
        bookingId:   booking.id,
      });
    }

    // Notify the target employee (new barber if changed, original otherwise)
    {
      const origEmpUserId = (booking.employee as { user_id?: string | null } | null)?.user_id ?? null;
      const targetEmpUserId = newEmployeeId ? (newBarberUserId ?? null) : origEmpUserId;
      if (targetEmpUserId) {
        await createNotification({
          shopId:      booking.shop_id as string,
          recipientId: targetEmpUserId,
          type:        'booking_rescheduled',
          title:       'Booking Rescheduled',
          body:        `${emailBase.customerName}'s appointment was moved to ${formatDateTimeInZone(startTime, emailBase.timezone)}`,
          bookingId:   booking.id,
        });
      }
    }

    return NextResponse.json(updated);
  }

  // ── Update notes ──────────────────────────────────────────────────────────
  if (action === 'update_notes') {
    if (!isAssignedEmployee) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { notes } = body as { notes?: unknown };
    if (typeof notes !== 'string') {
      return NextResponse.json({ error: 'notes must be a string' }, { status: 400 });
    }
    if (notes.length > 500) {
      return NextResponse.json({ error: 'Notes cannot exceed 500 characters' }, { status: 400 });
    }
    const { error: notesErr } = await admin
      .from('bookings')
      .update({ notes })
      .eq('id', bookingId);
    if (notesErr) return NextResponse.json({ error: notesErr.message }, { status: 500 });
    return NextResponse.json({ notes });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
