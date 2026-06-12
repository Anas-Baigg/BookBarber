import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const targetEmployeeId = new URL(request.url).searchParams.get('employeeId');

  let empId: string;
  let shopId: string;

  if (targetEmployeeId) {
    const { data: profile } = await admin
      .from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { data: emp } = await admin
      .from('employees')
      .select('id, shop_id, shop:shops(owner_id)')
      .eq('id', targetEmployeeId)
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

  const [servicesRes, overridesRes, configRes] = await Promise.all([
    admin
      .from('services')
      .select('id, name, description, duration_minutes')
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .order('display_order')
      .order('name'),
    admin
      .from('employee_services')
      .select('service_id, duration_minutes')
      .eq('employee_id', empId),
    admin
      .from('shop_config')
      .select('buffer_minutes, slot_interval_minutes')
      .eq('shop_id', shopId)
      .single(),
  ]);

  const services           = servicesRes.data  ?? [];
  const overrides          = overridesRes.data ?? [];
  const bufferMinutes      = configRes.data?.buffer_minutes      ?? 5;
  const slotIntervalMinutes = configRes.data?.slot_interval_minutes ?? 15;

  const overrideMap = new Map(overrides.map((o) => [o.service_id, o.duration_minutes]));

  const result = services.map((svc) => {
    const empDuration = overrideMap.get(svc.id) ?? null;
    return {
      id:                 svc.id,
      name:               svc.name,
      description:        svc.description,
      base_duration:      svc.duration_minutes,
      employee_duration:  empDuration,
      effective_duration: empDuration ?? svc.duration_minutes,
    };
  });

  return NextResponse.json({ services: result, buffer_minutes: bufferMinutes, slot_interval_minutes: slotIntervalMinutes });
}
