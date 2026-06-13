import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fromZonedTime } from 'date-fns-tz';

const SEARCH_ID_CAP = 100;

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page      = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10));
  const limit     = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
  const status    = searchParams.get('status')    ?? '';
  const search    = searchParams.get('search')    ?? '';
  const date      = searchParams.get('date')      ?? ''; // yyyy-MM-dd single date
  const startDate = searchParams.get('startDate') ?? ''; // yyyy-MM-dd range start
  const endDate   = searchParams.get('endDate')   ?? ''; // yyyy-MM-dd range end

  // Get employee + shop timezone in one query
  const { data: employee } = await supabase
    .from('employees')
    .select('id, shop:shops(timezone)')
    .eq('user_id', user.id)
    .single();

  if (!employee) {
    return NextResponse.json({ bookings: [], totalCount: 0, page: 1, totalPages: 0, searchCapped: false });
  }

  const timezone = (employee.shop as { timezone?: string } | null)?.timezone ?? 'UTC';

  // Name search: resolve matching customer IDs first, cap at SEARCH_ID_CAP to keep the IN clause small
  let customerIds: string[] | null = null;
  let searchCapped = false;
  if (search.trim()) {
    const { data: matchingProfiles } = await supabase
      .from('profiles')
      .select('id')
      .ilike('full_name', `%${search.trim()}%`)
      .limit(SEARCH_ID_CAP + 1); // fetch one extra to detect whether cap was hit

    const ids = (matchingProfiles ?? []).map((p) => p.id);
    if (ids.length === 0) {
      return NextResponse.json({ bookings: [], totalCount: 0, page, totalPages: 0, searchCapped: false });
    }
    if (ids.length > SEARCH_ID_CAP) {
      searchCapped = true;
      customerIds = ids.slice(0, SEARCH_ID_CAP);
    } else {
      customerIds = ids;
    }
  }

  const now  = new Date().toISOString();
  const from = (page - 1) * limit;
  const to   = from + limit - 1;

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

  if (status)      query = query.eq('status', status);
  if (customerIds) query = query.in('customer_id', customerIds);

  // Single date takes precedence over range when both are provided
  if (date) {
    const dayStart = fromZonedTime(`${date}T00:00:00`, timezone).toISOString();
    const dayEnd   = fromZonedTime(`${date}T23:59:59.999`, timezone).toISOString();
    query = query.gte('start_time', dayStart).lt('start_time', dayEnd);
  } else {
    if (startDate) query = query.gte('start_time', fromZonedTime(`${startDate}T00:00:00`, timezone).toISOString());
    if (endDate)   query = query.lte('start_time', fromZonedTime(`${endDate}T23:59:59.999`, timezone).toISOString());
  }

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return NextResponse.json({ bookings: data ?? [], totalCount, page, totalPages, searchCapped });
}
