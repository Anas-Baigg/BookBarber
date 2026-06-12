import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendTimeOffRequestReceived } from '@/lib/emails';
import { createNotification } from '@/lib/notifications';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// GET — employee's own time off requests
export async function GET(_request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (!employee) return NextResponse.json([], { status: 200 });

  const { data, error } = await supabase
    .from('time_off_requests')
    .select('*')
    .eq('employee_id', employee.id)
    .order('date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST — submit a new time off request
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { date, reason } = await request.json();
  if (!date || !reason) {
    return NextResponse.json({ error: 'date and reason are required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Get employee + shop + admin email for notification
  const { data: employee } = await admin
    .from('employees')
    .select('id, name, shop:shops(id, name, owner_id, timezone)')
    .eq('user_id', user.id)
    .single();

  if (!employee) return NextResponse.json({ error: 'No employee record' }, { status: 404 });

  const shop = (employee.shop as unknown) as { id: string; name: string; owner_id: string; timezone: string } | null;

  // Fix 8: server-side past-date guard in shop's local timezone
  const shopTz  = shop?.timezone ?? 'UTC';
  const todayStr = format(toZonedTime(new Date(), shopTz), 'yyyy-MM-dd');
  if (date <= todayStr) {
    return NextResponse.json(
      { error: 'Time off requests cannot be submitted for past dates.' },
      { status: 400 }
    );
  }

  const { data: inserted, error } = await supabase
    .from('time_off_requests')
    .insert({ employee_id: employee.id, date, reason })
    .select()
    .single();

  if (error) {
    if (error.message.includes('unique')) {
      return NextResponse.json({ error: 'You already have a request for this date.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Notify admin
  if (shop?.owner_id) {
    try {
      const { data: adminProfile } = await admin
        .from('profiles')
        .select('email')
        .eq('id', shop.owner_id)
        .single();
      if (adminProfile?.email) {
        await sendTimeOffRequestReceived({
          adminEmail:   adminProfile.email,
          employeeName: employee.name,
          date,
          reason,
          shopName:     shop.name,
          appUrl:       APP_URL,
        });
      }
    } catch (err) {
      console.error('[employee/time-off POST] admin notify failed:', err);
    }
  }

  if (shop?.owner_id) {
    await createNotification({
      shopId:      shop.id,
      recipientId: shop.owner_id,
      type:        'time_off_requested',
      title:       'Time Off Request',
      body:        `${employee.name as string} has requested time off on ${format(parseISO(`${date}T12:00:00`), 'MMMM d, yyyy')}`,
      employeeId:  employee.id as string,
    });
  }

  return NextResponse.json(inserted, { status: 201 });
}

// DELETE — withdraw a pending request
export async function DELETE(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const admin = createAdminClient();

  // Pre-fetch before deleting so we have notification context after the delete
  const { data: torRecord } = await admin
    .from('time_off_requests')
    .select('id, date, status, employee_id')
    .eq('id', id)
    .single();

  // RLS policy tor_delete_employee_pending enforces status = 'pending' and ownership
  const { error } = await supabase
    .from('time_off_requests')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify admin only if this was a pending request
  if (torRecord?.status === 'pending' && torRecord.employee_id) {
    const { data: emp } = await admin
      .from('employees')
      .select('id, name, shop:shops(id, owner_id)')
      .eq('id', torRecord.employee_id as string)
      .single();

    const shop = emp?.shop as unknown as { id: string; owner_id: string } | null;
    if (emp && shop?.owner_id) {
      await createNotification({
        shopId:      shop.id,
        recipientId: shop.owner_id,
        type:        'time_off_withdrawn',
        title:       'Time Off Withdrawn',
        body:        `${emp.name as string} withdrew their time off request for ${format(parseISO(`${torRecord.date as string}T12:00:00`), 'MMMM d, yyyy')}`,
        employeeId:  emp.id as string,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
