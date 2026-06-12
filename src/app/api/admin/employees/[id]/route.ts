import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  sendEmployeeAccountRemoved,
  sendEmergencyCancellation,
  sendBarberReassigned,
  sendRescheduleOffer,
  sendBookingAssigned,
  sendEmployeeBookingCancelled,
  sendEmployeeDeletionSummary,
} from '@/lib/emails';
import type { UnavailabilityAction } from '@/types';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, bio } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const admin = createAdminClient();

  const { data: emp } = await admin
    .from('employees')
    .select('id, user_id, shop:shops(owner_id)')
    .eq('id', params.id)
    .single();

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const shop = (emp.shop as unknown) as { owner_id: string } | null;
  if (shop?.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error: updateErr } = await admin
    .from('employees')
    .update({ name: (name as string).trim(), bio: (bio as string | null)?.trim() || null })
    .eq('id', params.id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Keep profiles.full_name in sync with employees.name
  if (emp.user_id) {
    await admin
      .from('profiles')
      .update({ full_name: (name as string).trim() })
      .eq('id', emp.user_id as string);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const actions: UnavailabilityAction[] = body.actions ?? [];

  const admin = createAdminClient();

  const { data: emp } = await admin
    .from('employees')
    .select('id, name, user_id, shop_id, shop:shops(owner_id, name, timezone, slug, address)')
    .eq('id', params.id)
    .single();

  if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

  const shop = (emp.shop as unknown) as {
    owner_id: string; name: string; timezone: string; slug: string; address?: string | null;
  } | null;

  if (shop?.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date().toISOString();

  // Always re-query at deletion time to catch new bookings
  const { data: futureBookings } = await admin
    .from('bookings')
    .select(`
      id, start_time, end_time,
      customer:profiles!bookings_customer_id_fkey(full_name, email)
    `)
    .eq('employee_id', params.id)
    .in('status', ['confirmed', 'checked_in'])
    .gt('start_time', now);

  const unresolved = (futureBookings ?? []).filter(
    (b) => !actions.find((a) => a.bookingId === b.id)
  );

  if (unresolved.length > 0) {
    return NextResponse.json(
      { error: `${unresolved.length} upcoming booking(s) must be resolved before deletion.` },
      { status: 409 }
    );
  }

  // Validate: no reassign without a barber
  for (const a of actions) {
    if (a.action === 'reassign' && !a.newEmployeeId) {
      return NextResponse.json(
        { error: 'A replacement barber must be selected for all reassign actions.' },
        { status: 400 }
      );
    }
  }

  // Process booking actions via the atomic RPC
  if (actions.length > 0) {
    const rpcPayload = actions.map((a) => ({
      booking_id:      a.bookingId,
      action:          a.action,
      new_employee_id: a.newEmployeeId ?? null,
    }));

    const { error: rpcError } = await (admin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }> })
      .rpc('process_booking_actions', { p_actions: rpcPayload });

    if (rpcError) {
      console.error('[DELETE employee] RPC failed:', rpcError);
      return NextResponse.json({ error: 'Failed to process booking actions.' }, { status: 500 });
    }
  }

  // Send booking-resolution emails (after successful RPC)
  const shopName    = shop?.name    ?? '';
  const shopSlug    = shop?.slug    ?? '';
  const shopAddress = shop?.address ?? null;
  const timezone    = shop?.timezone ?? 'UTC';

  const newBarberNames = new Map<string, string>();

  for (const a of actions) {
    const booking = (futureBookings ?? []).find((b) => b.id === a.bookingId);
    if (!booking) continue;
    const customer = (booking.customer as unknown) as { full_name: string | null; email: string } | null;
    const customerEmail = customer?.email ?? '';
    const customerName  = customer?.full_name ?? 'Customer';

    try {
      if (a.action === 'cancel') {
        if (customerEmail) {
          await sendEmergencyCancellation({
            customerName, customerEmail, shopName, shopAddress,
            barberName: emp.name, startTime: booking.start_time, timezone,
            bookingId: booking.id, shopSlug, appUrl: APP_URL,
          });
        }
      } else if (a.action === 'offer_reschedule') {
        if (customerEmail) {
          const rescheduleDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          await sendRescheduleOffer({
            customerName, customerEmail, shopName, shopAddress,
            barberName: emp.name, startTime: booking.start_time, timezone,
            bookingId: booking.id, rescheduleDeadline, appUrl: APP_URL,
          });
        }
      } else if (a.action === 'reassign' && a.newEmployeeId) {
        const { data: newEmp } = await admin
          .from('employees')
          .select('id, name, user_id')
          .eq('id', a.newEmployeeId)
          .single();
        if (newEmp) {
          newBarberNames.set(a.bookingId, newEmp.name);
          if (customerEmail) {
            await sendBarberReassigned({
              customerName, customerEmail, shopName, shopAddress,
              barberName: emp.name, startTime: booking.start_time, timezone,
              bookingId: booking.id, appUrl: APP_URL,
              newBarberName: newEmp.name,
            });
          }
          if (newEmp.user_id) {
            const { data: newEmpProfile } = await admin
              .from('profiles').select('email').eq('id', newEmp.user_id).single();
            if (newEmpProfile?.email) {
              await sendBookingAssigned({
                employeeEmail: newEmpProfile.email, employeeName: newEmp.name,
                customerName, shopName, startTime: booking.start_time, timezone,
                bookingId: booking.id, appUrl: APP_URL,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[DELETE employee] email failed:', err);
    }
  }

  // Notify the employee being removed
  if (emp.user_id) {
    try {
      const { data: empProfile } = await admin
        .from('profiles').select('email').eq('id', emp.user_id).single();
      if (empProfile?.email) {
        await sendEmployeeAccountRemoved({
          employeeEmail: empProfile.email,
          employeeName:  emp.name,
          shopName,
          appUrl: APP_URL,
        });
      }
    } catch (err) {
      console.error('[DELETE employee] account-removed email failed:', err);
    }
  }

  // Delete the employee (cascades to schedules, overrides, TOR rows)
  const { error: deleteError } = await admin
    .from('employees')
    .delete()
    .eq('id', params.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  if (actions.length > 0 && user.email) {
    try {
      await sendEmployeeDeletionSummary({
        adminEmail:   user.email,
        employeeName: emp.name,
        shopName,
        actions: actions.map((a) => {
          const booking  = (futureBookings ?? []).find((b) => b.id === a.bookingId);
          const customer = (booking?.customer as unknown) as { full_name: string | null; email: string } | null;
          return {
            customerName:   customer?.full_name ?? 'Customer',
            startTime:      booking?.start_time ?? '',
            timezone,
            action:         a.action,
            newBarberName:  newBarberNames.get(a.bookingId),
          };
        }),
        appUrl: APP_URL,
      });
    } catch (err) {
      console.error('[DELETE employee] summary email failed:', err);
    }
  }

  return NextResponse.json({ ok: true });
}
