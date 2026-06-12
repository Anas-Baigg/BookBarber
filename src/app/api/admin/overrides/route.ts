import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAvailableReplacements } from '@/lib/replacement-barbers';
import {
  sendEmployeeScheduleChanged,
  sendEmployeeOverrideRemoved,
  sendEmergencyCancellation,
  sendRescheduleOffer,
  sendBookingAssigned,
  sendTimeOffApproved,
} from '@/lib/emails';
import type { EmployeeScheduleOverride, UnavailabilityAction } from '@/types';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// ── POST — save an override ────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: {
    employeeId: string;
    date:       string;
    isWorking:  boolean;
    startTime?: string | null;
    endTime?:   string | null;
    reason:     EmployeeScheduleOverride['reason'];
    notes?:     string | null;
    actions?:   UnavailabilityAction[]; // present on re-submit after 409
  } = await request.json();

  const { employeeId, date, isWorking, startTime, endTime, reason, notes } = body;
  const resolutionActions = body.actions ?? [];

  if (!employeeId || !date) {
    return NextResponse.json({ error: 'employeeId and date required' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: emp } = await admin
    .from('employees')
    .select('id, name, user_id, shop:shops(id, name, owner_id, slug, address, timezone, default_open_time, default_close_time)')
    .eq('id', employeeId)
    .single();

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const shop = (emp.shop as unknown) as {
    id: string; name: string; owner_id: string; slug: string; address?: string | null;
    timezone: string; default_open_time: string; default_close_time: string;
  } | null;

  if (shop?.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Day Off path: check for existing bookings (Fix 2B) ────────────────────
  if (!isWorking) {
    const tz = shop?.timezone ?? 'UTC';

    const { data: bookingsOnDate } = await admin
      .from('bookings')
      .select(`id, start_time, end_time, customer:profiles!bookings_customer_id_fkey(full_name, email)`)
      .eq('employee_id', employeeId)
      .in('status', ['confirmed', 'checked_in'])
      .gte('start_time', `${date}T00:00:00.000Z`)
      .lte('start_time', `${date}T23:59:59.999Z`);

    const submittedIds = new Set(resolutionActions.map((a) => a.bookingId));
    const unresolved   = (bookingsOnDate ?? []).filter((b) => !submittedIds.has(b.id));

    if (unresolved.length > 0) {
      const availableBySlot = await getAvailableReplacements({
        shopId:            shop!.id,
        excludeEmployeeId: employeeId,
        date,
        bookings:         (bookingsOnDate ?? []).map((b) => ({ bookingId: b.id, startUtc: b.start_time, endUtc: b.end_time })),
        shopTimezone:      tz,
        defaultOpenTime:   shop!.default_open_time  ?? '09:00',
        defaultCloseTime:  shop!.default_close_time ?? '18:00',
      });
      return NextResponse.json({ affectedBookings: bookingsOnDate, availableBySlot }, { status: 409 });
    }

    // Validate reassign actions
    for (const a of resolutionActions) {
      if (a.action === 'reassign' && !a.newEmployeeId) {
        return NextResponse.json(
          { error: 'A replacement barber must be selected for all reassign actions.' },
          { status: 400 }
        );
      }
    }

    // Process booking actions atomically via RPC
    if (resolutionActions.length > 0) {
      const rpcPayload = resolutionActions.map((a) => ({
        booking_id:      a.bookingId,
        action:          a.action,
        new_employee_id: a.newEmployeeId ?? null,
      }));
      const { error: rpcError } = await (admin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }> })
        .rpc('process_booking_actions', { p_actions: rpcPayload });
      if (rpcError) {
        console.error('[admin/overrides POST] RPC failed:', rpcError);
        return NextResponse.json({ error: 'Failed to process booking actions.' }, { status: 500 });
      }
    }

    // Send booking-resolution emails
    const shopName    = shop!.name;
    const shopSlug    = shop!.slug;
    const shopAddress = shop!.address ?? null;

    for (const a of resolutionActions) {
      const booking = (bookingsOnDate ?? []).find((b) => b.id === a.bookingId);
      if (!booking) continue;
      const customer      = (booking.customer as unknown) as { full_name: string | null; email: string } | null;
      const customerEmail = customer?.email     ?? '';
      const customerName  = customer?.full_name ?? 'Customer';

      try {
        if (a.action === 'cancel' && customerEmail) {
          await sendEmergencyCancellation({
            customerName, customerEmail, shopName, shopAddress, barberName: emp.name,
            startTime: booking.start_time, timezone: tz,
            bookingId: booking.id, shopSlug, appUrl: APP_URL,
          });
        } else if (a.action === 'offer_reschedule' && customerEmail) {
          const rescheduleDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          await sendRescheduleOffer({
            customerName, customerEmail, shopName, shopAddress, barberName: emp.name,
            startTime: booking.start_time, timezone: tz,
            bookingId: booking.id, rescheduleDeadline, appUrl: APP_URL,
          });
        } else if (a.action === 'reassign' && a.newEmployeeId) {
          const { data: newEmp } = await admin.from('employees').select('id, name, user_id').eq('id', a.newEmployeeId).single();
          if (newEmp?.user_id) {
            const { data: newEmpProfile } = await admin.from('profiles').select('email').eq('id', newEmp.user_id).single();
            if (newEmpProfile?.email) {
              await sendBookingAssigned({
                employeeEmail: newEmpProfile.email, employeeName: newEmp.name,
                customerName, shopName, startTime: booking.start_time, timezone: tz,
                bookingId: booking.id, appUrl: APP_URL,
              });
            }
          }
        }
      } catch (err) { console.error('[admin/overrides POST] booking email failed:', err); }
    }
  }

  // Save the override
  const { error } = await admin
    .from('employee_schedule_overrides')
    .upsert({
      employee_id: employeeId,
      date,
      is_working:  isWorking,
      start_time:  isWorking && startTime ? startTime : null,
      end_time:    isWorking && endTime   ? endTime   : null,
      reason:      reason  ?? 'other',
      notes:       notes   ?? null,
      created_by:  user.id,
    }, { onConflict: 'employee_id,date' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify employee of the override change
  if (emp.user_id) {
    try {
      const { data: empProfile } = await admin.from('profiles').select('email').eq('id', emp.user_id).single();
      if (empProfile?.email) {
        const type = !isWorking ? 'day_off' : (startTime && endTime) ? 'different_hours' : 'extra_day';
        await sendEmployeeScheduleChanged({
          employeeEmail: empProfile.email, employeeName: emp.name, date,
          type: type as 'day_off' | 'different_hours' | 'extra_day',
          startTime: startTime ?? undefined, endTime: endTime ?? undefined,
          notes: notes ?? null, shopName: shop?.name ?? '', appUrl: APP_URL,
        });
      }
    } catch (err) { console.error('[admin/overrides POST] schedule-changed email failed:', err); }
  }

  // Fix 12: auto-approve any pending TOR for this employee+date
  if (!isWorking) {
    const { data: pendingTor } = await admin
      .from('time_off_requests')
      .select('id, reason, employee_id')
      .eq('employee_id', employeeId)
      .eq('date', date)
      .eq('status', 'pending')
      .single();

    if (pendingTor) {
      await admin.from('time_off_requests').update({
        status:      'approved',
        admin_notes: 'Automatically approved — a day off override was created for this date.',
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      }).eq('id', pendingTor.id);

      if (emp.user_id) {
        try {
          const { data: empProfile } = await admin.from('profiles').select('email').eq('id', emp.user_id).single();
          if (empProfile?.email) {
            await sendTimeOffApproved({
              employeeEmail: empProfile.email, employeeName: emp.name,
              date, shopName: shop?.name ?? '', appUrl: APP_URL,
            });
          }
        } catch (err) { console.error('[admin/overrides POST] auto-approve TOR email failed:', err); }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

// ── DELETE — remove an override ────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { overrideId } = await request.json();
  if (!overrideId) return NextResponse.json({ error: 'overrideId required' }, { status: 400 });

  const admin = createAdminClient();

  const { data: ov } = await admin
    .from('employee_schedule_overrides')
    .select('id, date, employee_id, employee:employees(name, user_id, shop:shops(name, owner_id))')
    .eq('id', overrideId)
    .single();

  if (!ov) return NextResponse.json({ error: 'Override not found' }, { status: 404 });

  const emp  = (ov.employee as unknown) as { name: string; user_id: string | null; shop: { name: string; owner_id: string } | null } | null;
  if (emp?.shop?.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await admin
    .from('employee_schedule_overrides')
    .delete()
    .eq('id', overrideId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (emp?.user_id) {
    try {
      const { data: empProfile } = await admin.from('profiles').select('email').eq('id', emp.user_id).single();
      if (empProfile?.email) {
        await sendEmployeeOverrideRemoved({
          employeeEmail: empProfile.email, employeeName: emp.name,
          date: ov.date, shopName: emp.shop?.name ?? '', appUrl: APP_URL,
        });
      }
    } catch (err) { console.error('[admin/overrides DELETE] email failed:', err); }
  }

  return NextResponse.json({ ok: true });
}
