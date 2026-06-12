import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId    = searchParams.get('shopId');
  const serviceId = searchParams.get('serviceId'); // optional
  const date      = searchParams.get('date');       // optional

  if (!shopId) {
    return NextResponse.json(
      { error: 'Missing required param: shopId' },
      { status: 400 }
    );
  }

  const supabase = createClient();

  // ── No serviceId — legacy booking or admin barber-selection without a service.
  // Return the full shop roster; callers only need id/name in this path.
  if (!serviceId) {
    const { data: employees } = await supabase
      .from('public_employees')
      .select('id, name, bio')
      .eq('shop_id', shopId)
      .order('name');

    return NextResponse.json(employees ?? []);
  }

  // ── Service provided — validate it belongs to the shop and is active ────────
  const { data: service } = await supabase
    .from('services')
    .select('id, shop_id, duration_minutes, is_active')
    .eq('id', serviceId)
    .single();

  if (!service || service.shop_id !== shopId) {
    return NextResponse.json({ error: 'Service not found for this shop' }, { status: 404 });
  }
  if (!service.is_active) {
    return NextResponse.json({ error: 'Service not active' }, { status: 400 });
  }

  const baseDuration = service.duration_minutes;

  const { data: employees } = await supabase
    .from('public_employees')
    .select('id, name, bio')
    .eq('shop_id', shopId)
    .order('name');

  if (!employees || employees.length === 0) return NextResponse.json([]);

  const empIds = employees.map((e) => e.id);

  // Per-employee service duration overrides
  const { data: empServiceRows } = await supabase
    .from('employee_services')
    .select('employee_id, duration_minutes')
    .in('employee_id', empIds)
    .eq('service_id', serviceId);

  const durationByEmp = new Map<string, number>();
  for (const r of empServiceRows ?? []) {
    if (r.duration_minutes != null) {
      durationByEmp.set(r.employee_id as string, r.duration_minutes as number);
    }
  }

  // When no date is provided (barber selection happens before date is chosen),
  // return the full shop roster with their effective durations.
  if (!date) {
    const result = employees.map((e) => ({
      id:                 e.id,
      name:               e.name,
      bio:                e.bio,
      effective_duration: durationByEmp.get(e.id) ?? baseDuration,
    }));
    return NextResponse.json(result);
  }

  // Date provided — filter to barbers who actually work that date.
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();

  const [
    { data: torRows },
    { data: overrideRows },
    { data: schedules },
  ] = await Promise.all([
    supabase
      .from('time_off_requests')
      .select('employee_id')
      .in('employee_id', empIds)
      .eq('date', date)
      .in('status', ['pending', 'approved']),
    supabase
      .from('public_schedule_overrides')
      .select('employee_id, is_working')
      .in('employee_id', empIds)
      .eq('date', date),
    supabase
      .from('employee_schedules')
      .select('employee_id, day_of_week, is_off')
      .in('employee_id', empIds)
      .eq('day_of_week', dayOfWeek),
  ]);

  const torBlocked  = new Set((torRows      ?? []).map((r) => r.employee_id as string));
  const overrideOff = new Set(
    (overrideRows ?? []).filter((o) => !o.is_working).map((o) => o.employee_id as string)
  );
  const overrideOn  = new Set(
    (overrideRows ?? []).filter((o) => o.is_working).map((o) => o.employee_id as string)
  );
  const scheduledOn = new Set(
    (schedules ?? []).filter((s) => !s.is_off).map((s) => s.employee_id as string)
  );

  const result = employees
    .filter(
      (e) =>
        !torBlocked.has(e.id) &&
        !overrideOff.has(e.id) &&
        (overrideOn.has(e.id) || scheduledOn.has(e.id))
    )
    .map((e) => ({
      id:                 e.id,
      name:               e.name,
      bio:                e.bio,
      effective_duration: durationByEmp.get(e.id) ?? baseDuration,
    }));

  return NextResponse.json(result);
}
