import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(_request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: shops } = await admin
    .from('shops')
    .select('id')
    .eq('owner_id', user.id);

  const shopIds = (shops ?? []).map((s) => s.id);
  if (shopIds.length === 0) return NextResponse.json([]);

  const { data, error } = await admin
    .from('services')
    .select('id, shop_id, name, description, duration_minutes, price, is_active, display_order, created_at')
    .in('shop_id', shopIds)
    .order('shop_id')
    .order('display_order')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { shop_id, name, description, duration_minutes, price, is_active, display_order } = body;

  if (!shop_id || !name?.trim() || !duration_minutes) {
    return NextResponse.json({ error: 'shop_id, name, and duration_minutes are required' }, { status: 400 });
  }
  if (duration_minutes < 5 || duration_minutes > 480) {
    return NextResponse.json({ error: 'Duration must be between 5 and 480 minutes' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: shop } = await admin
    .from('shops')
    .select('id')
    .eq('id', shop_id)
    .eq('owner_id', user.id)
    .single();

  if (!shop) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await admin
    .from('services')
    .insert({
      shop_id,
      name: name.trim(),
      description: description?.trim() || null,
      duration_minutes,
      price: price ?? null,
      is_active: is_active ?? true,
      display_order: display_order ?? 0,
    })
    .select('id, shop_id, name, description, duration_minutes, price, is_active, display_order, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
