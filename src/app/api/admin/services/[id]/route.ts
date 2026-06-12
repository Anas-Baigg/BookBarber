import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function verifyOwnership(serviceId: string, userId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from('services')
    .select('id, shop:shops(owner_id)')
    .eq('id', serviceId)
    .single();
  const shop = data?.shop as unknown as { owner_id: string } | null;
  if (shop?.owner_id !== userId) return null;
  return data;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = await verifyOwnership(params.id, user.id);
  if (!service) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.name          !== undefined) updates.name             = body.name.trim();
  if (body.description   !== undefined) updates.description      = body.description?.trim() || null;
  if (body.duration_minutes !== undefined) updates.duration_minutes = body.duration_minutes;
  if (body.price         !== undefined) updates.price            = body.price ?? null;
  if (body.is_active     !== undefined) updates.is_active        = body.is_active;
  if (body.display_order !== undefined) updates.display_order    = body.display_order;

  if (updates.duration_minutes !== undefined) {
    const d = updates.duration_minutes as number;
    if (d < 5 || d > 480) {
      return NextResponse.json({ error: 'Duration must be between 5 and 480 minutes' }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('services')
    .update(updates)
    .eq('id', params.id)
    .select('id, shop_id, name, description, duration_minutes, price, is_active, display_order, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const service = await verifyOwnership(params.id, user.id);
  if (!service) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminClient();

  const { data: futureBookings } = await admin
    .from('bookings')
    .select('id')
    .eq('service_id', params.id)
    .in('status', ['confirmed', 'checked_in'])
    .gte('start_time', new Date().toISOString())
    .limit(1);

  if ((futureBookings ?? []).length > 0) {
    return NextResponse.json(
      { error: 'This service has upcoming bookings. Deactivate it instead of deleting.' },
      { status: 409 }
    );
  }

  const { error } = await admin.from('services').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
