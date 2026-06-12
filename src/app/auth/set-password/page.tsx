'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Lock } from 'lucide-react';

export default function SetPasswordPage() {
  const supabase = createClient();

  const [checking, setChecking]   = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [done, setDone]           = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        window.location.replace('/auth/login');
        return;
      }
      setUserEmail(session.user.email ?? '');
      setChecking(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) {
        setError(updateErr.message);
        return;
      }

      // Fix 6: notify the shop admin when an employee first activates their account.
      // Fire-and-forget — the route is idempotent via activated_notified flag so
      // repeat calls (e.g. password change) are silent no-ops.
      try {
        const { data: { session: sess } } = await supabase.auth.getSession();
        if (sess) {
          const { data: p } = await supabase
            .from('profiles').select('role').eq('id', sess.user.id).single();
          if (p?.role === 'employee') {
            fetch('/api/notifications/employee-activated', { method: 'POST' }).catch(() => {});
          }
        }
      } catch {}

      setDone(true);

      // Short pause so the user sees the success state, then redirect by role
      setTimeout(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { window.location.replace('/auth/login'); return; }

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

        window.location.replace(dest);
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7 text-green-400" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Password set!</h2>
          <p className="text-gray-400 text-sm">Taking you to your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-gold flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7 text-dark" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Create your password</h1>
          <p className="text-gray-400 text-sm">
            {userEmail && (
              <>
                You&apos;re signed in as <span className="text-white">{userEmail}</span>
                <br />
              </>
            )}
            Set a password to secure your account.
          </p>
        </div>

        <div className="bg-dark-100 border border-dark-300 rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label="New password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ characters"
              required
              autoComplete="new-password"
            />
            <Input
              label="Confirm password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              required
              autoComplete="new-password"
            />

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              Set Password &amp; Continue
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
