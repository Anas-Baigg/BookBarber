import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: shop } = await admin
    .from('shops')
    .select('id, owner_id, deleted_at')
    .eq('id', params.id)
    .single();

  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  if (shop.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (shop.deleted_at) return NextResponse.json({ error: 'Shop is already archived' }, { status: 409 });

  const { error } = await admin
    .from('shops')
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
    .eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
