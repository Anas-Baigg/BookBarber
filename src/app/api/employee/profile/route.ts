import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, bio } = await request.json();

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const trimmedName = name.trim();
  const trimmedBio  = typeof bio === 'string' ? bio.trim() : null;

  // Update employees.name and employees.bio — allowed by employees_update_self RLS policy
  const { error: empError } = await supabase
    .from('employees')
    .update({ name: trimmedName, bio: trimmedBio || null })
    .eq('user_id', user.id);

  if (empError) return NextResponse.json({ error: empError.message }, { status: 500 });

  // Update profiles.full_name — allowed by profiles_update_own RLS policy
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ full_name: trimmedName })
    .eq('id', user.id);

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
