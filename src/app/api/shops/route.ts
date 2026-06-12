import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');

  if (slug) {
    const { data, error } = await supabase
      .from('shops')
      .select('*, employees(id, name, bio)')
      .eq('slug', slug)
      .single();

    if (error || !data) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    return NextResponse.json(data);
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('shops')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at');

  return NextResponse.json(data ?? []);
}
