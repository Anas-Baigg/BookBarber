import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const PAGE_LIMIT = 25;

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Resolve shop IDs owned by this admin
  const { data: shops } = await admin
    .from('shops').select('id').eq('owner_id', user.id).is('deleted_at', null);
  const shopIds = (shops ?? []).map((s) => s.id);
  if (shopIds.length === 0) {
    return NextResponse.json({ bookings: [], totalCount: 0, page: 1, totalPages: 0 });
  }

  const { searchParams } = new URL(request.url);
  const page      = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10));
  const limit     = Math.max(1, parseInt(searchParams.get('limit') ?? String(PAGE_LIMIT), 10));
  const shopId    = searchParams.get('shopId')    ?? '';
  const status    = searchParams.get('status')    ?? '';
  const startDate = searchParams.get('startDate') ?? '';
  const endDate   = searchParams.get('endDate')   ?? '';
  const search    = searchParams.get('search')    ?? '';

  // Two-step search: resolve matching customer IDs first so the parent-row filter is exact
  let customerIds: string[] | null = null;
  if (search.trim()) {
    const { data: matchingProfiles } = await admin
      .from('profiles')
      .select('id')
      .or(`full_name.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%`);
    customerIds = (matchingProfiles ?? []).map((p) => p.id);
    if (customerIds.length === 0) {
      return NextResponse.json({ bookings: [], totalCount: 0, page, totalPages: 0 });
    }
  }

  const from = (page - 1) * limit;
  const to   = from + limit - 1;

  let query = admin
    .from('bookings')
    .select(
      `id, status, start_time, end_time, notes, no_show_set_at,
       service_name, service_duration_minutes,
       shop:shops(id, name, timezone),
       employee:employees(id, name),
       customer:profiles!bookings_customer_id_fkey(id, full_name, email)`,
      { count: 'exact' }
    )
    .in('shop_id', shopIds)
    .order('start_time', { ascending: false })
    .range(from, to);

  if (shopId)    query = query.eq('shop_id', shopId);
  if (status)    query = query.eq('status', status);
  if (startDate) query = query.gte('start_time', `${startDate}T00:00:00.000Z`);
  if (endDate)   query = query.lte('start_time', `${endDate}T23:59:59.999Z`);
  if (customerIds) query = query.in('customer_id', customerIds);

  const { data, count, error } = await query;

  if (error) {
    console.error('[admin/bookings GET] query error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  return NextResponse.json({ bookings: data ?? [], totalCount, page, totalPages });
}
