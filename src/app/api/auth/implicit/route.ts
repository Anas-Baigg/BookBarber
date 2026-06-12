import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Receives an implicit-flow access_token from the browser
// (read from window.location.hash in /auth/callback's inline script),
// calls setSession so Supabase writes proper auth cookies on the response,
// then returns the destination URL for the browser to navigate to.

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.access_token) {
    return NextResponse.json({ error: 'access_token is required' }, { status: 400 });
  }

  const { access_token, refresh_token = '', type = '' } = body as {
    access_token: string;
    refresh_token: string;
    type: string;
  };

  // Collect cookies the Supabase client wants to write
  const pending: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            pending.push({ name, value, options: options as Record<string, unknown> })
          );
        },
      },
    }
  );

  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });

  if (error || !data.session) {
    return NextResponse.json(
      { error: error?.message ?? 'Session could not be established' },
      { status: 401 }
    );
  }

  // Determine where to send the user
  let redirect = '/dashboard';

  if (type === 'invite' || type === 'recovery') {
    // Invited users and password-reset users must set a password first
    redirect = '/auth/set-password';
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.session.user.id)
      .single();

    redirect =
      profile?.role === 'admin'
        ? '/admin'
        : profile?.role === 'employee'
        ? '/employee'
        : '/dashboard';
  }

  // Build response and attach the auth cookies
  const response = NextResponse.json({ redirect });
  pending.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
  });

  return response;
}
