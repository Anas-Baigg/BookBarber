import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmployeeScheduleBaseChanged, sendEmployeeBookingCancelled, sendBarberReassigned, sendBookingAssigned } from '@/lib/emails';
import type { UnavailabilityAction } from '@/types';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// PATCH — update a single field on an employee's weekly schedule row.
// When is_off: true is set, checks for future bookings on matching weekdays.
// Returns 409 if conflicts exist (unresolved). Caller re-submits with actions
// to process them atomically via RPC before saving the schedule change.
export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    employeeId,
    dayOfWeek,
    field,
    value,
    actions,
  }: {
    employeeId: string;
    dayOfWeek:  number;
    field:      'start_time' | 'end_time' | 'is_off';
    value:      string | boolean;
    actions?:   UnavailabilityAction[];
  } = await request.json();

  if (!employeeId || dayOfWeek === undefined || !field) {
    return NextResponse.json({ error: 'employeeId, dayOfWeek, field are required' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: emp } = await admin
    .from('employees')
    .select('id, name, user_id, shop:shops(id, name, owner_id, timezone)')
    .eq('id', employeeId)
    .single();

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const shop = (emp.shop as unknown) as { id: string; name: string; owner_id: string; timezone: string } | null;
  if (shop?.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── is_off: true — check for future bookings on this weekday ─────────────
  if (field === 'is_off' && value === true) {
    const now = new Date().toISOString();

    // PostgreSQL EXTRACT(DOW ...) uses Sunday=0 … Saturday=6, matching our day_of_week convention.
    // We use a raw filter via RPC-less approach: fetch future bookings then filter by weekday in JS.
    // This avoids needing a custom RPC while keeping the query simple.
    const { data: futureBookings } = await admin
      .from('bookings')
      .select(`
        id, start_time, end_time, employee_id,
        customer:profiles!bookings_customer_id_fkey(full_name, email)
      `)
      .eq('employee_id', employeeId)
      .in('status', ['confirmed', 'checked_in'])
      .gt('start_time', now)
      .order('start_time', { ascending: true });

    const tz = shop?.timezone ?? 'UTC';

    // Filter to bookings whose weekday (in shop timezone) matches dayOfWeek
    const { toZonedTime } = await import('date-fns-tz');
    const conflicting = (futureBookings ?? []).filter((b) => {
      const localDate = toZonedTime(b.start_time, tz);
      return localDate.getDay() === dayOfWeek;
    });

    const submittedIds = new Set((actions ?? []).map((a) => a.bookingId));
    const unresolved   = conflicting.filter((b) => !submittedIds.has(b.id));

    if (unresolved.length > 0) {
      // Build replacement barbers for each affected booking
      const { getAvailableReplacements } = await import('@/lib/replacement-barbers');
      const availableBySlot: Record<string, { id: string; name: string }[]> = {};

      for (const b of unresolved) {
        const dateStr = toZonedTime(b.start_time, tz).toISOString().slice(0, 10);
        const reps    = await getAvailableReplacements({
          shopId:            shop!.id,
          excludeEmployeeId: employeeId,
          date:              dateStr,
          bookings: [{ bookingId: b.id, startUtc: b.start_time, endUtc: b.end_time }],
          shopTimezone:      tz,
          defaultOpenTime:   '09:00',
          defaultCloseTime:  '18:00',
        });
        Object.assign(availableBySlot, reps);
      }

      return NextResponse.json(
        { affectedBookings: conflicting, availableBySlot, shopTimezone: tz },
        { status: 409 }
      );
    }

    // Actions provided — process them via RPC atomically before saving the schedule change
    if ((actions ?? []).length > 0) {
      for (const a of actions ?? []) {
        if (a.action === 'reassign' && !a.newEmployeeId) {
          return NextResponse.json(
            { error: 'A replacement barber must be selected for all reassign actions.' },
            { status: 400 }
          );
        }
      }

      const rpcPayload = (actions ?? []).map((a) => ({
        booking_id:      a.bookingId,
        action:          a.action,
        new_employee_id: a.newEmployeeId ?? null,
      }));

      const { error: rpcError } = await (admin as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
      }).rpc('process_booking_actions', { p_actions: rpcPayload });

      if (rpcError) {
        console.error('[admin/schedules PATCH] RPC failed:', rpcError);
        return NextResponse.json({ error: 'Failed to process booking actions.' }, { status: 500 });
      }

      // Send emails per booking action
      for (const a of actions ?? []) {
        const booking = conflicting.find((b) => b.id === a.bookingId);
        if (!booking) continue;
        const customer      = (booking.customer as unknown) as { full_name: string | null; email: string } | null;
        const customerEmail = customer?.email ?? '';
        const customerName  = customer?.full_name ?? 'Customer';
        try {
          if (a.action === 'cancel' && customerEmail) {
            await sendEmployeeBookingCancelled({
              employeeEmail: '', employeeName: emp.name,
              customerName, startTime: booking.start_time,
              timezone: tz, shopName: shop?.name ?? '',
              reason: 'Recurring day marked as off by admin',
              appUrl: APP_URL,
            });
          } else if (a.action === 'reassign' && a.newEmployeeId) {
            const { data: newEmp } = await admin
              .from('employees').select('id, name, user_id').eq('id', a.newEmployeeId).single();
            if (newEmp) {
              if (customerEmail) {
                await sendBarberReassigned({
                  customerName, customerEmail,
                  shopName: shop?.name ?? '', shopAddress: null,
                  barberName: emp.name, startTime: booking.start_time,
                  timezone: tz, bookingId: booking.id,
                  appUrl: APP_URL, newBarberName: newEmp.name,
                });
              }
              if (newEmp.user_id) {
                const { data: newEmpProfile } = await admin
                  .from('profiles').select('email').eq('id', newEmp.user_id).single();
                if (newEmpProfile?.email) {
                  await sendBookingAssigned({
                    employeeEmail: newEmpProfile.email, employeeName: newEmp.name,
                    customerName, shopName: shop?.name ?? '',
                    startTime: booking.start_time, timezone: tz,
                    bookingId: booking.id, appUrl: APP_URL,
                  });
                }
              }
            }
          }
        } catch (err) {
          console.error('[admin/schedules PATCH] email failed:', err);
        }
      }
    }
  }

  // ── Save the schedule row ─────────────────────────────────────────────────
  const { data: existing } = await admin
    .from('employee_schedules')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('day_of_week', dayOfWeek)
    .single();

  if (existing) {
    await admin
      .from('employee_schedules')
      .update({ [field]: value })
      .eq('id', existing.id);
  } else {
    await admin.from('employee_schedules').insert({
      employee_id: employeeId,
      day_of_week: dayOfWeek,
      start_time:  field === 'start_time' ? value : '09:00',
      end_time:    field === 'end_time'   ? value : '18:00',
      is_off:      field === 'is_off'     ? value : false,
    });
  }

  // Notify employee on meaningful on/off changes (not every time field edit)
  if (field === 'is_off' && emp.user_id) {
    try {
      const { data: empProfile } = await admin
        .from('profiles').select('email').eq('id', emp.user_id).single();
      if (empProfile?.email) {
        await sendEmployeeScheduleBaseChanged({
          employeeEmail: empProfile.email,
          employeeName:  emp.name,
          shopName:      shop?.name ?? '',
          appUrl:        APP_URL,
        });
      }
    } catch (err) {
      console.error('[admin/schedules PATCH] email failed:', err);
    }
  }

  return NextResponse.json({ ok: true });
}
