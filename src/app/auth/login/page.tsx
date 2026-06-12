'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Scissors, CheckCircle } from 'lucide-react';

const TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

export default function LoginPage() {
  const supabase = createClient();

  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [urlError, setUrlError] = useState(''); // ?error= from redirect
  const [formError, setFormError] = useState('');
  const [status, setStatus]   = useState<'idle' | 'signing-in' | 'redirecting'>('idle');

  // Read ?error= query param client-side
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get('error');
    if (e) setUrlError(decodeURIComponent(e));
  }, []);

  const loading = status !== 'idle';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setStatus('signing-in');

    try {
      const { data, error: authError } = await withTimeout(
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        TIMEOUT_MS,
        'Sign in timed out — your Supabase project may be waking up. Wait 15 s and try again.'
      );

      if (authError) {
        const msg = authError.message;
        if (msg.toLowerCase().includes('confirm')) {
          setFormError(
            'Your email is not confirmed. Check your inbox for a confirmation link, or disable "Confirm email" in Supabase → Auth → Providers → Email.'
          );
        } else if (msg.toLowerCase().includes('invalid')) {
          setFormError('Incorrect email or password.');
        } else {
          setFormError(msg);
        }
        return;
      }

      if (!data?.session) {
        setFormError(
          'Login succeeded but no session was created. Your email may need confirmation — check your inbox.'
        );
        return;
      }

      setStatus('redirecting');

      // Honor ?returnTo for customers (admins/employees always go to their dashboard)
      const returnTo = new URLSearchParams(window.location.search).get('returnTo');

      // Try JWT role first; fall back to profiles table if app_metadata.role is not set
      let role: string | undefined =
        data.user?.app_metadata?.role ?? data.user?.user_metadata?.role;
      if (!role && data.user?.id) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .single();
        role = (profileData as { role?: string } | null)?.role;
      }
      let dest = '/dashboard';
      if (role === 'admin') dest = '/admin';
      else if (role === 'employee') dest = '/employee';
      else if (returnTo) dest = returnTo;

      window.location.replace(dest);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Unexpected error — please try again.');
    } finally {
      if (status !== 'redirecting') setStatus('idle');
    }
  }

  if (status === 'redirecting') {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-7 h-7 text-green-400" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Signed in!</h2>
          <p className="text-gray-400 text-sm">Loading your dashboard…</p>
          <p className="text-gray-600 text-xs mt-2">This may take a moment on first load.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-gold flex items-center justify-center">
              <Scissors className="w-5 h-5 text-dark" />
            </div>
            <span className="font-bold text-2xl">
              Book<span className="text-gradient-gold">Barber</span>
            </span>
          </Link>
          <h1 className="text-2xl font-bold mt-6 mb-2">Welcome back</h1>
          <p className="text-gray-400 text-sm">Sign in to your BookBarber account</p>
        </div>

        <div className="bg-dark-100 border border-dark-300 rounded-2xl p-8">
          {/* Error forwarded from callback / confirm routes */}
          {urlError && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm mb-5">
              {urlError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />

            <div className="space-y-1.5">
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
              <div className="text-right">
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-gray-500 hover:text-gold transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm leading-relaxed">
                {formError}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Don&apos;t have an account?{' '}
            <Link href="/auth/signup" className="text-gold hover:text-gold-light transition-colors font-medium">
              Create one
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-gray-600 mt-4">
          First sign-in may take up to 20 s while the database wakes up.
        </p>
      </div>
    </div>
  );
}
