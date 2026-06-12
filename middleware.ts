import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

// Service-role client — bypasses RLS for role checks in middleware
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function isStaleTokenError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e  = err as { message?: string; code?: string };
  const msg = (e.message ?? '').toLowerCase();
  const code = (e.code   ?? '').toLowerCase();
  return (
    msg.includes('refresh_token_not_found') ||
    msg.includes('invalid_grant')           ||
    code === 'refresh_token_not_found'
  );
}

function getRoleFromUser(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const u  = user as Record<string, unknown>;
  const am = u.app_metadata as Record<string, unknown> | undefined;
  return (am?.role as string) || null;
}

/** Fetch role with a hard timeout so a slow DB never hangs middleware. */
async function getRole(userId: string): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000));
  const query = (async () => {
    try {
      const { data } = await adminClient()
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();
      return data?.role ?? null;
    } catch {
      return null;
    }
  })();
  return Promise.race([query, timeout]);
}

/**
 * Copy refreshed session cookies from supabaseResponse onto a redirect response.
 * Without this, any token refresh that happened during getUser() is lost when
 * middleware returns a redirect instead of the supabaseResponse directly.
 */
function createRedirectWithCookies(
  url: string | URL,
  request: NextRequest,
  supabaseResponse: NextResponse
): NextResponse {
  const redirectResponse = NextResponse.redirect(
    typeof url === 'string' ? new URL(url, request.url) : url
  );
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    // getUser() validates the JWT with the Supabase Auth server on every request.
    // It always makes a network call but is the only reliable way to detect live
    // sessions — getClaims() with HS256 also makes a network call internally and
    // silently returns null on any error, causing auth guards to miss valid sessions.
    let user: unknown = null;
    let userId: string | undefined;
    try {
      const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        if (isStaleTokenError(userError)) {
          request.cookies.getAll().forEach(({ name }) => {
            if (name.startsWith('sb-')) supabaseResponse.cookies.delete(name);
          });
          return supabaseResponse;
        }
        // Other errors (network, cold start) → treat as unauthenticated; fall through
      } else {
        user   = authUser;
        userId = authUser?.id;
      }
    } catch (authErr: unknown) {
      if (isStaleTokenError(authErr)) {
        request.cookies.getAll().forEach(({ name }) => {
          if (name.startsWith('sb-')) supabaseResponse.cookies.delete(name);
        });
        return supabaseResponse;
      }
      // Other thrown errors → treat as unauthenticated; fall through
    }

    const { pathname } = request.nextUrl;

    // Redirect authenticated users from the landing page to their dashboard.
    // /shops has no restriction — it is publicly accessible to everyone.
    if (pathname === '/') {
      if (user) {
        const role = getRoleFromUser(user) ?? await getRole(userId!);
        if (role === 'admin')    return createRedirectWithCookies('/admin',     request, supabaseResponse);
        if (role === 'employee') return createRedirectWithCookies('/employee',  request, supabaseResponse);
        if (role === 'customer') return createRedirectWithCookies('/dashboard', request, supabaseResponse);
        // Unknown/null role falls through and sees the landing page
      }
    }

    // ── Protected routes ─────────────────────────────────────────────────────

    // /admin — requires admin role
    if (pathname.startsWith('/admin')) {
      if (!user) return createRedirectWithCookies('/auth/login', request, supabaseResponse);
      const role = getRoleFromUser(user) ?? await getRole(userId!);
      if (role !== 'admin') {
        const dest = role === 'employee' ? '/employee' : '/dashboard';
        return createRedirectWithCookies(dest, request, supabaseResponse);
      }
    }

    // /employee — requires employee or admin role
    if (pathname.startsWith('/employee')) {
      if (!user) return createRedirectWithCookies('/auth/login', request, supabaseResponse);
      const role = getRoleFromUser(user) ?? await getRole(userId!);
      if (!role || !['employee', 'admin'].includes(role)) {
        return createRedirectWithCookies('/dashboard', request, supabaseResponse);
      }
    }

    // /dashboard and /booking — just requires being logged in
    if (pathname.startsWith('/dashboard') || pathname.startsWith('/booking')) {
      if (!user) {
        const loginUrl = new URL('/auth/login', request.url);
        if (pathname.startsWith('/booking/')) {
          loginUrl.searchParams.set('returnTo', pathname);
        }
        return createRedirectWithCookies(loginUrl, request, supabaseResponse);
      }
      // Redirect privileged roles away from the customer dashboard
      if (pathname.startsWith('/dashboard')) {
        const role = getRoleFromUser(user) ?? await getRole(userId!);
        if (role === 'admin')    return createRedirectWithCookies('/admin',    request, supabaseResponse);
        if (role === 'employee') return createRedirectWithCookies('/employee', request, supabaseResponse);
      }
    }

    // /auth/set-password — must be logged in (invited user has a session)
    if (pathname.startsWith('/auth/set-password')) {
      if (!user) return createRedirectWithCookies('/auth/login', request, supabaseResponse);
    }

    // ── Redirect already-authenticated users away from auth pages ─────────────
    // Exclusions:
    //   /auth/callback      — must run to exchange tokens
    //   /auth/confirm       — must run to verify OTP
    //   /auth/set-password  — authenticated users land here after invite
    //   /auth/forgot-password — accessible regardless of auth state
    const isAuthPage = pathname.startsWith('/auth/');
    const isExcluded =
      pathname.startsWith('/auth/callback') ||
      pathname.startsWith('/auth/confirm') ||
      pathname.startsWith('/auth/set-password') ||
      pathname.startsWith('/auth/forgot-password');

    if (isAuthPage && !isExcluded && user) {
      const role = getRoleFromUser(user) ?? await getRole(userId!);
      const dest =
        role === 'admin' ? '/admin' : role === 'employee' ? '/employee' : '/dashboard';
      return createRedirectWithCookies(dest, request, supabaseResponse);
    }
  } catch (err) {
    // Never crash the middleware — log and pass through
    if (process.env.NODE_ENV !== 'production') console.error('[middleware]', err);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
