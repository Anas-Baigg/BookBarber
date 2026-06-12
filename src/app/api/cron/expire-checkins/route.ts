import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const CRON_TOKEN = process.env.CRON_SECRET;

// Auto-complete checked_in bookings whose start_time is more than 3 hours in the past.
// No emails sent — silent cleanup only.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (CRON_TOKEN && auth !== `Bearer ${CRON_TOKEN}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  const { data: stale, error: queryError } = await admin
    .from('bookings')
    .select('id')
    .eq('status', 'checked_in')
    .lt('start_time', cutoff);

  if (queryError) {
    console.error('[cron/expire-checkins] query error:', queryError.message);
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  if (!stale || stale.length === 0) {
    return NextResponse.json({ completed: 0 });
  }

  const ids = stale.map((b) => b.id);
  const { error: updateError } = await admin
    .from('bookings')
    .update({ status: 'completed' })
    .in('id', ids);

  if (updateError) {
    console.error('[cron/expire-checkins] update error:', updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  console.log(`[cron/expire-checkins] auto-completed ${ids.length} stale checked_in bookings`);
  return NextResponse.json({ completed: ids.length });
}
