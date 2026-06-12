import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const VALID_INTERVALS = [10, 15, 20, 30];
const VALID_BUFFERS   = [0, 5, 10, 15];

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: shop } = await admin
    .from('shops').select('owner_id').eq('id', params.id).single();
  if (shop?.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: config } = await admin
    .from('shop_config')
    .select('slot_interval_minutes, buffer_minutes')
    .eq('shop_id', params.id)
    .single();

  return NextResponse.json(config ?? { slot_interval_minutes: 15, buffer_minutes: 5 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { slot_interval_minutes, buffer_minutes } = body;

  if (!VALID_INTERVALS.includes(slot_interval_minutes as number)) {
    return NextResponse.json(
      { error: 'slot_interval_minutes must be one of 10, 15, 20, 30' },
      { status: 400 }
    );
  }
  if (!VALID_BUFFERS.includes(buffer_minutes as number)) {
    return NextResponse.json(
      { error: 'buffer_minutes must be one of 0, 5, 10, 15' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: shop } = await admin
    .from('shops').select('owner_id').eq('id', params.id).single();
  if (shop?.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await admin
    .from('shop_config')
    .upsert(
      { shop_id: params.id, slot_interval_minutes, buffer_minutes },
      { onConflict: 'shop_id' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
