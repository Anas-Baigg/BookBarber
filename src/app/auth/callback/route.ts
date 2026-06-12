import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const errorParam = searchParams.get('error');
  const errorDesc = searchParams.get('error_description');

  // Auth provider sent an error
  if (errorParam) {
    const msg = encodeURIComponent(errorDesc ?? errorParam);
    return NextResponse.redirect(`${APP_URL}/auth/login?error=${msg}`);
  }

  // ── PKCE flow (?code=) ─────────────────────────────────────────────────────
  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        `${APP_URL}/auth/login?error=${encodeURIComponent(error.message)}`
      );
    }

    // If a ?next= was provided, respect it (e.g. ?next=/auth/set-password)
    if (next) {
      return NextResponse.redirect(`${APP_URL}${next}`);
    }

    // Role-based redirect
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.redirect(`${APP_URL}/auth/login`);

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    const dest =
      profile?.role === 'admin'
        ? '/admin'
        : profile?.role === 'employee'
        ? '/employee'
        : '/dashboard';

    return NextResponse.redirect(`${APP_URL}${dest}`);
  }

  // ── Implicit flow (#access_token=) ────────────────────────────────────────
  //
  // The URL hash fragment is NEVER sent to the server.  When Supabase
  // redirects here after verifying an invite or magic-link, the server sees
  // no ?code= and no ?error=.  We serve a minimal HTML page whose inline
  // script reads window.location.hash and POSTs the tokens to our own API
  // route, which stores them as proper server-side cookies.
  //
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BookBarber – Signing in</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0f0f0f;color:#fff;font-family:Inter,system-ui,sans-serif;
         display:flex;align-items:center;justify-content:center;min-height:100vh}
    .wrap{display:flex;flex-direction:column;align-items:center;gap:16px}
    .logo{width:48px;height:48px;background:linear-gradient(135deg,#C9A84C,#E8C86B);
          border-radius:12px;display:flex;align-items:center;justify-content:center;
          font-size:22px}
    .msg{color:#9ca3af;font-size:14px}
    .spinner{width:20px;height:20px;border:2px solid rgba(201,168,76,.3);
             border-top-color:#C9A84C;border-radius:50%;
             animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .row{display:flex;align-items:center;gap:8px}
    .err{color:#f87171;font-size:13px;text-align:center;max-width:320px}
    a{color:#C9A84C;font-size:13px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">✂</div>
    <div class="row" id="loading"><div class="spinner"></div><span class="msg">Signing you in…</span></div>
    <div id="errBox" style="display:none">
      <p class="err" id="errMsg"></p>
      <a href="/auth/login" style="display:block;text-align:center;margin-top:12px">Back to sign in →</a>
    </div>
  </div>

  <script>
    (function () {
      var hash = window.location.hash;
      if (!hash || !hash.includes('access_token=')) {
        window.location.replace('/dashboard');
        return;
      }
      var params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
      var access_token  = params.get('access_token');
      var refresh_token = params.get('refresh_token') || '';
      var type          = params.get('type') || '';

      if (!access_token) {
        showErr('No access token found in the link. Try signing in manually.');
        return;
      }

      fetch('/api/auth/implicit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ access_token: access_token, refresh_token: refresh_token, type: type })
      })
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
      .then(function(res){
        if (!res.ok || res.d.error) {
          showErr(res.d.error || 'Authentication failed. Please try again.');
        } else {
          window.location.replace(res.d.redirect || '/dashboard');
        }
      })
      .catch(function(){ showErr('Unexpected error. Please try again.'); });

      function showErr(msg) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('errMsg').textContent = msg;
        document.getElementById('errBox').style.display = 'block';
      }
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
