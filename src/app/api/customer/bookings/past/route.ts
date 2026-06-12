import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fix 4: only customers may access this endpoint.
  const role = (user.user_metadata?.role ?? user.app_metadata?.role) as string | undefined;
  if (role !== 'customer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page   = Math.max(1, parseInt(searchParams.get('page')  ?? '1', 10));
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10)));
  const status = searchParams.get('status') ?? '';
  const from   = (page - 1) * limit;
  const to     = page * limit - 1;
  const now    = new Date().toISOString();

  const admin = createAdminClient();

  // Mirror isPast: start_time <= now OR status === 'cancelled'.
  // Exclude pending_reschedule — surfaced separately in the dashboard alert section.
  const baseQuery = admin
    .from('bookings')
    .select(
      `id, start_time, status,
       employee:employees(id, name),
       shop:shops(id, name, timezone, slug, address)`,
      { count: 'exact' }
    )
    .eq('customer_id', user.id)
    .neq('status', 'pending_reschedule')
    .or(`start_time.lte.${now},status.eq.cancelled`);

  const filteredQuery = status ? baseQuery.eq('status', status) : baseQuery;

  const { data, count, error } = await filteredQuery
    .order('start_time', { ascending: false })
    .range(from, to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    bookings:   data    ?? [],
    totalCount: count   ?? 0,
    page,
    limit,
  });
}
