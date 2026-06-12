import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page   = Math.max(1, parseInt(searchParams.get('page')  ?? '1'));
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20')));
  const status = searchParams.get('status') ?? '';

  const { data: employee } = await supabase
    .from('employees')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (!employee) return NextResponse.json({ bookings: [], total: 0, page, limit });

  const now  = new Date().toISOString();
  const from = (page - 1) * limit;
  const to   = from + limit - 1;

  // Past = start_time is before now, OR terminal status regardless of time
  let query = supabase
    .from('bookings')
    .select(
      `*, employee:employees(id, name), shop:shops(id, name, timezone),
       customer:profiles!bookings_customer_id_fkey(id, full_name, email)`,
      { count: 'exact' }
    )
    .eq('employee_id', employee.id)
    .or(`start_time.lt.${now},status.in.(cancelled,completed,no_show)`)
    .order('start_time', { ascending: false })
    .range(from, to);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ bookings: data ?? [], total: count ?? 0, page, limit });
}
