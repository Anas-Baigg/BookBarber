'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Navbar from '@/components/layout/Navbar';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { CheckCircle, User, Lock } from 'lucide-react';

export default function CustomerProfilePage() {
  const supabase = createClient();

  const [fullName,    setFullName]    = useState('');
  const [nameLoading, setNameLoading] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError,   setNameError]   = useState('');

  const [currentPw,  setCurrentPw]  = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirmPw,  setConfirmPw]  = useState('');
  const [pwLoading,  setPwLoading]  = useState(false);
  const [pwSuccess,  setPwSuccess]  = useState(false);
  const [pwError,    setPwError]    = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', session.user.id)
        .single();
      if (profile?.full_name) setFullName(profile.full_name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError('');
    setNameSuccess(false);
    if (!fullName.trim()) { setNameError('Full name is required.'); return; }
    setNameLoading(true);
    const res = await fetch('/api/customer/profile', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fullName }),
    });
    if (res.ok) {
      setNameSuccess(true);
    } else {
      const data = await res.json();
      setNameError(data.error ?? 'Failed to save name.');
    }
    setNameLoading(false);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwSuccess(false);
    if (newPw.length < 8)    { setPwError('New password must be at least 8 characters.'); return; }
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return; }
    setPwLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) { setPwError('Could not verify your account.'); return; }

      // Verify current password before allowing the change
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email:    session.user.email,
        password: currentPw,
      });
      if (verifyErr) { setPwError('Current password is incorrect.'); return; }

      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
      if (updateErr) { setPwError(updateErr.message); return; }

      // Sign out all other devices — non-fatal if this fails
      try {
        await fetch('/api/auth/revoke-other-sessions', { method: 'POST' });
      } catch {
        // ignore
      }

      setPwSuccess(true);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err: unknown) {
      setPwError(err instanceof Error ? err.message : 'Unexpected error.');
    } finally {
      setPwLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <main className="max-w-lg mx-auto px-4 sm:px-6 pt-24 pb-16">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">My Profile</h1>
          <p className="text-gray-400 text-sm">Update your name and password.</p>
        </div>

        {/* Section A — Personal details */}
        <div className="bg-dark-100 border border-dark-300 rounded-2xl p-6 mb-6">
          <h2 className="font-semibold mb-5 flex items-center gap-2">
            <User className="w-4 h-4 text-gold" />
            Personal Details
          </h2>
          <form onSubmit={handleSaveName} className="space-y-4">
            <Input
              label="Full name"
              type="text"
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); setNameSuccess(false); }}
              placeholder="Your full name"
              autoComplete="name"
              required
            />
            {nameError && <p className="text-sm text-red-400">{nameError}</p>}
            {nameSuccess && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle className="w-4 h-4" /> Name updated successfully.
              </div>
            )}
            <Button type="submit" loading={nameLoading} size="sm">Save Name</Button>
          </form>
        </div>

        {/* Section B — Change password */}
        <div className="bg-dark-100 border border-dark-300 rounded-2xl p-6">
          <h2 className="font-semibold mb-5 flex items-center gap-2">
            <Lock className="w-4 h-4 text-gold" />
            Change Password
          </h2>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <Input
              label="Current password"
              type="password"
              value={currentPw}
              onChange={(e) => { setCurrentPw(e.target.value); setPwSuccess(false); }}
              placeholder="Your current password"
              autoComplete="current-password"
              required
            />
            <Input
              label="New password"
              type="password"
              value={newPw}
              onChange={(e) => { setNewPw(e.target.value); setPwSuccess(false); }}
              placeholder="8+ characters"
              autoComplete="new-password"
              required
            />
            <Input
              label="Confirm new password"
              type="password"
              value={confirmPw}
              onChange={(e) => { setConfirmPw(e.target.value); setPwSuccess(false); }}
              placeholder="Repeat your new password"
              autoComplete="new-password"
              required
            />
            {pwError && <p className="text-sm text-red-400">{pwError}</p>}
            {pwSuccess && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle className="w-4 h-4" /> Password updated successfully.
              </div>
            )}
            <Button type="submit" loading={pwLoading} size="sm">Change Password</Button>
          </form>
        </div>
      </main>
    </div>
  );
}
