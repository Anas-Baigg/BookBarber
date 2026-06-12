import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAvailableReplacements } from '@/lib/replacement-barbers';
import { sendEmployeeScheduleChanged, sendEmergencyCancellation, sendRescheduleOffer, sendBookingAssigned } from '@/lib/emails';
import { fromZonedTime } from 'date-fns-tz';
import type { UnavailabilityAction } from '@/types';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// ── GET — list all special hours for a shop ───────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: shop } = await admin
    .from('shops').select('owner_id').eq('id', params.id).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (shop.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await admin
    .from('shop_special_hours')
    .select('id, shop_id, date, is_closed, open_time, close_time')
    .eq('shop_id', params.id)
    .order('date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// ── DELETE — remove a specific special hours row by date ──────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { date }: { date: string } = await request.json();
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  const admin = createAdminClient();

  const { data: shop } = await admin
    .from('shops').select('owner_id').eq('id', params.id).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (shop.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await admin
    .from('shop_special_hours')
    .delete()
    .eq('shop_id', params.id)
    .eq('date', date);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// ── POST — upsert special hours (closure or reduced hours) ────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    date,
    openTime,
    closeTime,
    isClosed,
    actions,
  }: {
    date:       string;
    openTime?:  string | null;
    closeTime?: string | null;
    isClosed:   boolean;
    actions?:   UnavailabilityAction[];
  } = body;

  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  const admin = createAdminClient();

  const { data: shop } = await admin
    .from('shops')
    .select('id, name, owner_id, timezone, slug, address, default_open_time, default_close_time')
    .eq('id', params.id)
    .single();

  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (shop.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Extract typed values into locals so nested closures can reference them without null-check issues
  const tz           = (shop as unknown as { timezone?: string }).timezone ?? 'UTC';
  const shopName     = shop.name;
  const shopAddress  = (shop as unknown as { address?: string | null }).address ?? null;
  const shopSlug     = (shop as unknown as { slug?: string }).slug ?? '';
  const defaultOpen  = (shop as unknown as { default_open_time?: string }).default_open_time  ?? '09:00';
  const defaultClose = (shop as unknown as { default_close_time?: string }).default_close_time ?? '18:00';

  // ── Helper: build conflict list and available replacements ────────────────
  async function buildConflictResponse(conflictBookings: {
    id: string; start_time: string; end_time: string; employee_id: string | null;
    customer: unknown;
  }[]) {
    const rawEmpIds = conflictBookings.map((b) => b.employee_id).filter((id): id is string => !!id);
    const empIds    = rawEmpIds.filter((id, i) => rawEmpIds.indexOf(id) === i);
    const availableBySlot: Record<string, { id: string; name: string }[]> = {};

    for (const empId of empIds) {
      const bkgsForEmp = conflictBookings.filter((b) => b.employee_id === empId);
      const replacements = await getAvailableReplacements({
        shopId:            params.id,
        excludeEmployeeId: empId,
        date,
        bookings: bkgsForEmp.map((b) => ({ bookingId: b.id, startUtc: b.start_time, endUtc: b.end_time })),
        shopTimezone:      tz,
        defaultOpenTime:   defaultOpen,
        defaultCloseTime:  defaultClose,
      });
      Object.assign(availableBySlot, replacements);
    }
    return availableBySlot;
  }

  // ── Helper: send post-RPC emails ──────────────────────────────────────────
  async function sendResolutionEmails(
    resolvedActions: UnavailabilityAction[],
    bookingsList: { id: string; start_time: string; customer: unknown; employee_id: string | null }[]
  ) {
    for (const a of resolvedActions) {
      const booking = bookingsList.find((b) => b.id === a.bookingId);
      if (!booking) continue;
      const customer      = (booking.customer as unknown) as { full_name: string | null; email: string } | null;
      const customerEmail = customer?.email ?? '';
      const customerName  = customer?.full_name ?? 'Customer';
      const { data: origEmp } = await admin.from('employees').select('name').eq('id', booking.employee_id!).single();
      const barberName = origEmp?.name ?? '';

      try {
        if (a.action === 'cancel' && customerEmail) {
          await sendEmergencyCancellation({
            customerName, customerEmail, shopName, shopAddress,
            barberName, startTime: booking.start_time, timezone: tz,
            bookingId: booking.id, shopSlug, appUrl: APP_URL,
          });
        } else if (a.action === 'offer_reschedule' && customerEmail) {
          const rescheduleDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          await sendRescheduleOffer({
            customerName, customerEmail, shopName, shopAddress,
            barberName, startTime: booking.start_time, timezone: tz,
            bookingId: booking.id, rescheduleDeadline, appUrl: APP_URL,
          });
        } else if (a.action === 'reassign' && a.newEmployeeId) {
          const { data: newEmp } = await admin.from('employees').select('id, name, user_id').eq('id', a.newEmployeeId).single();
          if (newEmp?.user_id) {
            const { data: newEmpProfile } = await admin.from('profiles').select('email').eq('id', newEmp.user_id).single();
            if (newEmpProfile?.email) {
              await sendBookingAssigned({
                employeeEmail: newEmpProfile.email, employeeName: newEmp.name,
                customerName, shopName, startTime: booking.start_time,
                timezone: tz, bookingId: booking.id, appUrl: APP_URL,
              });
            }
          }
        }
      } catch (err) {
        console.error('[special-hours POST] email failed:', err);
      }
    }
  }

  // ── Helper: run RPC + handle errors ──────────────────────────────────────
  async function runRpc(resolvedActions: UnavailabilityAction[]): Promise<NextResponse | null> {
    if (resolvedActions.length === 0) return null;

    for (const a of resolvedActions) {
      if (a.action === 'reassign' && !a.newEmployeeId) {
        return NextResponse.json(
          { error: 'A replacement barber must be selected for all reassign actions.' },
          { status: 400 }
        );
      }
    }

    const rpcPayload = resolvedActions.map((a) => ({
      booking_id:      a.bookingId,
      action:          a.action,
      new_employee_id: a.newEmployeeId ?? null,
    }));

    const { error: rpcError } = await (admin as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
    }).rpc('process_booking_actions', { p_actions: rpcPayload });

    if (rpcError) {
      console.error('[special-hours POST] RPC failed:', rpcError);
      return NextResponse.json({ error: 'Failed to process booking actions.' }, { status: 500 });
    }
    return null;
  }

  // ── Reduced-hours path ────────────────────────────────────────────────────
  if (!isClosed) {
    // Only check for booking conflicts when actual time bounds are being set
    if (openTime && closeTime) {
      const openUtc  = fromZonedTime(`${date}T${openTime}:00`, tz).toISOString();
      const closeUtc = fromZonedTime(`${date}T${closeTime}:00`, tz).toISOString();

      const { data: dayBookings } = await admin
        .from('bookings')
        .select('id, start_time, end_time, employee_id, customer:profiles!bookings_customer_id_fkey(full_name, email)')
        .eq('shop_id', params.id)
        .in('status', ['confirmed', 'checked_in'])
        .gte('start_time', `${date}T00:00:00.000Z`)
        .lte('start_time', `${date}T23:59:59.999Z`);

      // Bookings that start before new open time OR at/after new close time
      const outsideHours = (dayBookings ?? []).filter((b) => {
        const start = new Date(b.start_time);
        return start < new Date(openUtc) || start >= new Date(closeUtc);
      });

      const submittedIds = new Set((actions ?? []).map((a) => a.bookingId));
      const unresolved   = outsideHours.filter((b) => !submittedIds.has(b.id));

      if (unresolved.length > 0) {
        const availableBySlot = await buildConflictResponse(
          outsideHours as { id: string; start_time: string; end_time: string; employee_id: string | null; customer: unknown }[]
        );
        return NextResponse.json({ affectedBookings: outsideHours, availableBySlot }, { status: 409 });
      }

      // Process booking actions for outside-hours bookings
      if ((actions ?? []).length > 0) {
        const rpcErr = await runRpc(actions ?? []);
        if (rpcErr) return rpcErr;
        await sendResolutionEmails(
          actions ?? [],
          (dayBookings ?? []) as { id: string; start_time: string; customer: unknown; employee_id: string | null }[]
        );
      }
    }

    const { error } = await admin.from('shop_special_hours').upsert(
      { shop_id: params.id, date, open_time: openTime ?? null, close_time: closeTime ?? null, is_closed: false },
      { onConflict: 'shop_id,date' }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Closure path ──────────────────────────────────────────────────────────
  const { data: existingBookings } = await admin
    .from('bookings')
    .select('id, start_time, end_time, employee_id, customer:profiles!bookings_customer_id_fkey(full_name, email)')
    .eq('shop_id', params.id)
    .in('status', ['confirmed', 'checked_in'])
    .gte('start_time', `${date}T00:00:00.000Z`)
    .lte('start_time', `${date}T23:59:59.999Z`);

  const submittedIds = new Set((actions ?? []).map((a) => a.bookingId));
  const unresolved   = (existingBookings ?? []).filter((b) => !submittedIds.has(b.id));

  if (unresolved.length > 0) {
    const availableBySlot = await buildConflictResponse(
      existingBookings as { id: string; start_time: string; end_time: string; employee_id: string | null; customer: unknown }[]
    );
    return NextResponse.json({ affectedBookings: existingBookings, availableBySlot }, { status: 409 });
  }

  // Process booking actions atomically
  if ((actions ?? []).length > 0) {
    const rpcErr = await runRpc(actions ?? []);
    if (rpcErr) return rpcErr;
    await sendResolutionEmails(
      actions ?? [],
      (existingBookings ?? []) as { id: string; start_time: string; customer: unknown; employee_id: string | null }[]
    );
  }

  // Save the closure
  const { error: upsertError } = await admin.from('shop_special_hours').upsert(
    { shop_id: params.id, date, open_time: null, close_time: null, is_closed: true },
    { onConflict: 'shop_id,date' }
  );
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  // Notify all employees at this shop about the closure
  const { data: shopEmployees } = await admin
    .from('employees').select('id, name, user_id').eq('shop_id', params.id);

  for (const emp of shopEmployees ?? []) {
    if (!emp.user_id) continue;
    try {
      const { data: empProfile } = await admin.from('profiles').select('email').eq('id', emp.user_id).single();
      if (empProfile?.email) {
        await sendEmployeeScheduleChanged({
          employeeEmail: empProfile.email, employeeName: emp.name,
          date, type: 'day_off',
          notes: `Shop closed on ${date}`,
          shopName, appUrl: APP_URL,
        });
      }
    } catch (err) {
      console.error('[special-hours POST] employee notify failed:', err);
    }
  }

  return NextResponse.json({ ok: true });
}
