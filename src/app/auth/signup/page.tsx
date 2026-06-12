'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Scissors, CheckCircle, Mail } from 'lucide-react';
import { validateEmail } from '@/lib/utils';

type SignupState = 'form' | 'confirm-email' | 'redirecting';

export default function SignupPage() {
  const supabase = createClient();

  const [state, setState]           = useState<SignupState>('form');
  const [fullName, setFullName]     = useState('');
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [errors, setErrors]         = useState<Record<string, string>>({});
  const [loading, setLoading]       = useState(false);

  function validate() {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = 'Full name is required';
    if (!email.trim()) errs.email = 'Email is required';
    else if (!validateEmail(email)) errs.email = 'Please use a valid, non-disposable email address';
    if (!password || password.length < 8) errs.password = 'Password must be at least 8 characters';
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim(), role: 'customer' },
        },
      });

      if (authError) {
        setErrors({ general: authError.message });
        return;
      }

      // Try to sign in immediately (works when email confirmation is disabled)
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (!signInError && signInData.session) {
        setState('redirecting');
        // Honor ?returnTo so the customer lands back on the booking page they came from
        const returnTo = new URLSearchParams(window.location.search).get('returnTo');
        window.location.replace(returnTo ?? '/dashboard');
        return;
      }

      // signInWithPassword failed → email confirmation is required
      setState('confirm-email');
    } catch (err: unknown) {
      setErrors({ general: err instanceof Error ? err.message : 'Unexpected error' });
    } finally {
      setLoading(false);
    }
  }

  // ── Email confirmation required ────────────────────────────────────────────
  if (state === 'confirm-email') {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Check your email</h2>
          <p className="text-gray-400 text-sm mb-2">
            We sent a confirmation link to{' '}
            <span className="text-white font-medium">{email}</span>.
          </p>
          <p className="text-gray-500 text-xs mb-6">
            Click the link to confirm your email, then come back to sign in.
          </p>
          <Link
            href="/auth/login"
            className="inline-block bg-gradient-gold text-dark font-semibold text-sm px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity"
          >
            Go to Sign In
          </Link>
          <p className="text-xs text-gray-600 mt-4">
            Didn&apos;t receive it? Check spam, or ask your admin to disable email confirmations in
            Supabase → Authentication → Providers → Email.
          </p>
        </div>
      </div>
    );
  }

  // ── Redirecting ────────────────────────────────────────────────────────────
  if (state === 'redirecting') {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-7 h-7 text-green-400" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Account created!</h2>
          <p className="text-gray-400 text-sm">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  // ── Registration form ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-dark flex items-center justify-center px-4 py-12">
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
          <h1 className="text-2xl font-bold mt-6 mb-2">Create your account</h1>
          <p className="text-gray-400 text-sm">Start booking appointments in seconds</p>
        </div>

        <div className="bg-dark-100 border border-dark-300 rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label="Full name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Alex Johnson"
              error={errors.fullName}
              autoComplete="name"
              required
            />
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              error={errors.email}
              hint="Must be a real email — we may send a confirmation."
              autoComplete="email"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ characters"
              error={errors.password}
              autoComplete="new-password"
              required
            />

            {errors.general && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {errors.general}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Create Account
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-gold hover:text-gold-light transition-colors font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
