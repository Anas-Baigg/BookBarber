import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAvailableReplacements } from '@/lib/replacement-barbers';
import {
  sendTimeOffApproved,
  sendTimeOffDenied,
  sendEmployeeScheduleChanged,
  sendEmergencyCancellation,
  sendRescheduleOffer,
  sendBookingAssigned,
} from '@/lib/emails';
import type { UnavailabilityAction } from '@/types';
import { createNotification } from '@/lib/notifications';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function GET(_request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('time_off_requests')
    .select('*, employee:employees(id, name, shop:shops(name))')
    .eq('status', 'pending')
    .order('date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: {
    id:         string;
    action:     'approve' | 'deny';
    adminNotes?: string;
    actions?:   UnavailabilityAction[]; // present on re-submit after 409
  } = await request.json();

  const { id, action, adminNotes } = body;
  const resolutionActions = body.actions ?? [];

  if (!id || !action) return NextResponse.json({ error: 'id and action required' }, { status: 400 });

  const admin = createAdminClient();

  const { data: req } = await admin
    .from('time_off_requests')
    .select('*, employee:employees(id, name, user_id, shop:shops(id, name, timezone, owner_id, slug, address, default_open_time, default_close_time))')
    .eq('id', id)
    .single();

  if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

  const employee = (req.employee as unknown) as {
    id: string; name: string; user_id: string | null;
    shop: { id: string; name: string; timezone: string; owner_id: string; slug: string; address?: string | null; default_open_time: string; default_close_time: string } | null;
  } | null;

  if (employee?.shop?.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Deny: immediate, no booking check needed ──────────────────────────────
  if (action === 'deny') {
    const { error: updateError } = await admin
      .from('time_off_requests')
      .update({ status: 'denied', admin_notes: adminNotes ?? null, reviewed_at: new Date().toISOString(), reviewed_by: user.id })
      .eq('id', id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    if (employee?.user_id) {
      try {
        const { data: empProfile } = await admin.from('profiles').select('email').eq('id', employee.user_id).single();
        if (empProfile?.email) {
          await sendTimeOffDenied({
            employeeEmail: empProfile.email, employeeName: employee.name,
            date: req.date, adminNotes: adminNotes ?? null,
            shopName: employee.shop?.name ?? '', appUrl: APP_URL,
          });
        }
      } catch (err) { console.error('[admin/time-off PATCH deny] email failed:', err); }

      await createNotification({
        shopId:      employee.shop?.id ?? '',
        recipientId: employee.user_id,
        type:        'time_off_denied',
        title:       'Time Off Not Approved',
        body:        `Your time off request for ${req.date} was not approved${adminNotes ? `. ${adminNotes}` : ''}`,
        employeeId:  employee.id,
      });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Approve path ───────────────────────────────────────────────────────────
  const tz    = employee?.shop?.timezone    ?? 'UTC';
  const date  = req.date;

  // Re-query bookings at submission time (Step 6)
  const { data: bookingsOnDate } = await admin
    .from('bookings')
    .select(`id, start_time, end_time, customer:profiles!bookings_customer_id_fkey(full_name, email)`)
    .eq('employee_id', employee!.id)
    .in('status', ['confirmed', 'checked_in'])
    .gte('start_time', `${date}T00:00:00.000Z`)
    .lte('start_time', `${date}T23:59:59.999Z`);

  const submittedIds  = new Set(resolutionActions.map((a) => a.bookingId));
  const unresolved    = (bookingsOnDate ?? []).filter((b) => !submittedIds.has(b.id));

  if (unresolved.length > 0) {
    const availableBySlot = await getAvailableReplacements({
      shopId:            employee!.shop!.id,
      excludeEmployeeId: employee!.id,
      date,
      bookings:         (bookingsOnDate ?? []).map((b) => ({ bookingId: b.id, startUtc: b.start_time, endUtc: b.end_time })),
      shopTimezone:      tz,
      defaultOpenTime:   employee!.shop!.default_open_time  ?? '09:00',
      defaultCloseTime:  employee!.shop!.default_close_time ?? '18:00',
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

  // Process booking actions atomically via RPC (Step 7)
  if (resolutionActions.length > 0) {
    const rpcPayload = resolutionActions.map((a) => ({
      booking_id:      a.bookingId,
      action:          a.action,
      new_employee_id: a.newEmployeeId ?? null,
    }));
    const { error: rpcError } = await (admin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }> })
      .rpc('process_booking_actions', { p_actions: rpcPayload });
    if (rpcError) {
      console.error('[admin/time-off approve] RPC failed:', rpcError);
      return NextResponse.json({ error: 'Failed to process booking actions.' }, { status: 500 });
    }
  }

  // Send booking-resolution emails after successful RPC (Step 8)
  const shopName    = employee!.shop!.name;
  const shopSlug    = employee!.shop!.slug;
  const shopAddress = employee!.shop!.address ?? null;

  for (const a of resolutionActions) {
    const booking = (bookingsOnDate ?? []).find((b) => b.id === a.bookingId);
    if (!booking) continue;
    const customer      = (booking.customer as unknown) as { full_name: string | null; email: string } | null;
    const customerEmail = customer?.email     ?? '';
    const customerName  = customer?.full_name ?? 'Customer';

    try {
      if (a.action === 'cancel' && customerEmail) {
        await sendEmergencyCancellation({
          customerName, customerEmail, shopName, shopAddress, barberName: employee!.name,
          startTime: booking.start_time, timezone: tz,
          bookingId: booking.id, shopSlug, appUrl: APP_URL,
        });
      } else if (a.action === 'offer_reschedule' && customerEmail) {
        const rescheduleDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await sendRescheduleOffer({
          customerName, customerEmail, shopName, shopAddress, barberName: employee!.name,
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
    } catch (err) { console.error('[admin/time-off approve] booking email failed:', err); }
  }

  // Complete the approval: update TOR, create override
  const { error: updateError } = await admin
    .from('time_off_requests')
    .update({ status: 'approved', admin_notes: adminNotes ?? null, reviewed_at: new Date().toISOString(), reviewed_by: user.id })
    .eq('id', id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await admin.from('employee_schedule_overrides').upsert(
    { employee_id: employee!.id, date, is_working: false, reason: 'personal', notes: req.reason, created_by: user.id },
    { onConflict: 'employee_id,date' }
  );

  if (employee?.user_id) {
    try {
      const { data: empProfile } = await admin.from('profiles').select('email').eq('id', employee.user_id).single();
      if (empProfile?.email) {
        await sendTimeOffApproved({
          employeeEmail: empProfile.email, employeeName: employee.name,
          date, shopName, appUrl: APP_URL,
        });
      }
    } catch (err) { console.error('[admin/time-off approve] approval email failed:', err); }

    await createNotification({
      shopId:      employee.shop?.id ?? '',
      recipientId: employee.user_id,
      type:        'time_off_approved',
      title:       'Time Off Approved',
      body:        `Your time off request for ${date} has been approved`,
      employeeId:  employee.id,
    });
  }

  return NextResponse.json({ ok: true });
}
