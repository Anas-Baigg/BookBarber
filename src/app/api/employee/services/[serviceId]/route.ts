import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { serviceId: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { duration_minutes, employeeId: bodyEmployeeId } = body;

  if (typeof duration_minutes !== 'number' || !Number.isInteger(duration_minutes)) {
    return NextResponse.json({ error: 'duration_minutes must be an integer' }, { status: 400 });
  }
  if (duration_minutes < 5 || duration_minutes > 480) {
    return NextResponse.json({ error: 'Duration must be between 5 and 480 minutes' }, { status: 400 });
  }

  const admin = createAdminClient();

  let empId: string;
  let shopId: string;

  if (bodyEmployeeId) {
    const { data: profile } = await admin
      .from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { data: emp } = await admin
      .from('employees')
      .select('id, shop_id, shop:shops(owner_id)')
      .eq('id', bodyEmployeeId)
      .single();
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    const empShop = (emp.shop as unknown) as { owner_id: string } | null;
    if (empShop?.owner_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    empId  = emp.id as string;
    shopId = emp.shop_id as string;
  } else {
    const { data: emp } = await admin
      .from('employees').select('id, shop_id').eq('user_id', user.id).single();
    if (!emp) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    empId  = emp.id as string;
    shopId = emp.shop_id as string;
  }

  const { data: svc } = await admin
    .from('services')
    .select('id, duration_minutes')
    .eq('id', params.serviceId)
    .eq('shop_id', shopId)
    .single();

  if (!svc) return NextResponse.json({ error: 'Service not found' }, { status: 404 });

  if (duration_minutes === svc.duration_minutes) {
    await admin
      .from('employee_services')
      .delete()
      .eq('employee_id', empId)
      .eq('service_id', params.serviceId);
    return NextResponse.json({
      ok: true,
      employee_duration: null,
      effective_duration: svc.duration_minutes,
    });
  }

  const { error } = await admin
    .from('employee_services')
    .upsert(
      { employee_id: empId, service_id: params.serviceId, duration_minutes },
      { onConflict: 'employee_id,service_id' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    employee_duration: duration_minutes,
    effective_duration: duration_minutes,
  });
}
