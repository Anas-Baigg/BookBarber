'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Navbar from '@/components/layout/Navbar';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import { User, Lock, Camera, CheckCircle, Tag } from 'lucide-react';

interface ServiceRow {
  id: string;
  name: string;
  description: string | null;
  base_duration: number;
  employee_duration: number | null;
  effective_duration: number;
}

export default function EmployeeProfilePage() {
  const supabase = createClient();

  // Display info
  const [name,      setName]      = useState('');
  const [bio,       setBio]       = useState('');
  const [email,     setEmail]     = useState('');
  const [infoSaving,  setInfoSaving]  = useState(false);
  const [infoSaved,   setInfoSaved]   = useState(false);
  const [infoError,   setInfoError]   = useState('');

  // Password change
  const [currentPassword,  setCurrentPassword]  = useState('');
  const [newPassword,      setNewPassword]      = useState('');
  const [confirmPassword,  setConfirmPassword]  = useState('');
  const [pwSaving,         setPwSaving]         = useState(false);
  const [pwSaved,          setPwSaved]          = useState(false);
  const [pwError,          setPwError]          = useState('');

  const [loading,    setLoading]    = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Services section
  const [services,        setServices]        = useState<ServiceRow[]>([]);
  const [bufferMinutes,   setBufferMinutes]   = useState(5);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError,   setServicesError]   = useState('');
  const [draftDurations,  setDraftDurations]  = useState<Record<string, string>>({});
  const [savingService,   setSavingService]   = useState<string | null>(null);
  const [savedService,    setSavedService]    = useState<string | null>(null);
  const [serviceErrors,   setServiceErrors]   = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { window.location.replace('/auth/login'); return; }
        const user = session.user;

        setEmail(user.email ?? '');

        const { data: emp } = await supabase
          .from('employees')
          .select('name, bio')
          .eq('user_id', user.id)
          .single();

        if (emp) {
          setName(emp.name ?? '');
          setBio(emp.bio  ?? '');
        } else {
          // Fall back to profile full_name if no employee record
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single();
          setName(profile?.full_name ?? '');
        }
      } catch {
        setFetchError('Could not load your profile. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/employee/services');
        if (!res.ok) throw new Error('Failed to load services');
        const data = await res.json();
        const rows: ServiceRow[] = data.services ?? [];
        setServices(rows);
        setBufferMinutes(data.buffer_minutes ?? 5);
        const drafts: Record<string, string> = {};
        rows.forEach((s) => { drafts[s.id] = String(s.effective_duration); });
        setDraftDurations(drafts);
      } catch {
        setServicesError('Could not load services. Please refresh the page.');
      } finally {
        setServicesLoading(false);
      }
    })();
  }, []);

  async function handleServiceSave(svc: ServiceRow) {
    const draft = draftDurations[svc.id] ?? String(svc.effective_duration);
    const dur   = parseInt(draft, 10);

    setServiceErrors((prev) => ({ ...prev, [svc.id]: '' }));

    if (isNaN(dur) || dur < 5)  { setServiceErrors((prev) => ({ ...prev, [svc.id]: 'Minimum 5 minutes.' })); return; }
    if (dur > 480)               { setServiceErrors((prev) => ({ ...prev, [svc.id]: 'Maximum 480 minutes.' })); return; }

    setSavingService(svc.id);
    const res = await fetch(`/api/employee/services/${svc.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ duration_minutes: dur }),
    });

    if (res.ok) {
      const updated = await res.json();
      setServices((prev) => prev.map((s) =>
        s.id === svc.id
          ? { ...s, employee_duration: updated.employee_duration, effective_duration: updated.effective_duration }
          : s
      ));
      setSavedService(svc.id);
      setTimeout(() => setSavedService((prev) => (prev === svc.id ? null : prev)), 3000);
    } else {
      const data = await res.json();
      setServiceErrors((prev) => ({ ...prev, [svc.id]: data.error ?? 'Failed to save.' }));
    }
    setSavingService(null);
  }

  async function handleInfoSave(e: React.FormEvent) {
    e.preventDefault();
    setInfoError('');
    setInfoSaved(false);
    setInfoSaving(true);

    const res = await fetch('/api/employee/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, bio }),
    });
    const data = await res.json();
    if (!res.ok) {
      setInfoError(data.error ?? 'Failed to save');
    } else {
      setInfoSaved(true);
      setTimeout(() => setInfoSaved(false), 3000);
    }
    setInfoSaving(false);
  }

  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwSaved(false);

    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match.');
      return;
    }

    setPwSaving(true);

    // Verify current password first
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (verifyError) {
      setPwError('Current password is incorrect.');
      setPwSaving(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setPwError(updateError.message);
    } else {
      try {
        await fetch('/api/auth/revoke-other-sessions', { method: 'POST' });
      } catch {
        // session revocation failure must not block success confirmation
      }
      setPwSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPwSaved(false), 3000);
    }
    setPwSaving(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-4">{fetchError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2 bg-gradient-gold text-dark font-semibold text-sm rounded-lg hover:opacity-90 transition-opacity"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 pt-24 pb-16">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">My Profile</h1>
          <p className="text-gray-400 text-sm">{email}</p>
        </div>

        {/* ── Section A: Display info ────────────────────────────────────── */}
        <Card className="mb-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-gold" />
            Display Info
          </h2>
          <form onSubmit={handleInfoSave} className="space-y-4">
            <Input
              label="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-300">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                placeholder="Tell customers about your specialty…"
                className="w-full px-4 py-2.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold resize-none"
              />
              <p className="text-xs text-gray-500">Shown to customers when they choose a barber.</p>
            </div>

            {infoError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {infoError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" loading={infoSaving} size="sm">
                Save Changes
              </Button>
              {infoSaved && (
                <span className="flex items-center gap-1 text-sm text-emerald-400">
                  <CheckCircle className="w-4 h-4" /> Saved
                </span>
              )}
            </div>
          </form>
        </Card>

        {/* ── Section B: Change password ────────────────────────────────── */}
        <Card className="mb-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Lock className="w-4 h-4 text-gold" />
            Change Password
          </h2>
          <form onSubmit={handlePasswordSave} className="space-y-4">
            <Input
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Your current password"
              required
              autoComplete="current-password"
            />
            <Input
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="8+ characters"
              required
              autoComplete="new-password"
            />
            <Input
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              required
              autoComplete="new-password"
            />

            {pwError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {pwError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" loading={pwSaving} size="sm">
                Update Password
              </Button>
              {pwSaved && (
                <span className="flex items-center gap-1 text-sm text-emerald-400">
                  <CheckCircle className="w-4 h-4" /> Password updated
                </span>
              )}
            </div>
          </form>
        </Card>

        {/* ── Section C: Profile photo placeholder ─────────────────────── */}
        <Card className="mb-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2 text-gray-400">
            <Camera className="w-4 h-4" />
            Profile Photo
          </h2>
          <div className="flex items-center gap-4 py-4">
            <div className="w-16 h-16 rounded-full bg-dark-300 border-2 border-dashed border-dark-400 flex items-center justify-center">
              <Camera className="w-6 h-6 text-gray-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Profile photos coming soon.</p>
              <p className="text-xs text-gray-600 mt-0.5">
                Your initials are shown to customers in the meantime.
              </p>
            </div>
          </div>
        </Card>

        {/* ── Section D: My Services ────────────────────────────────────── */}
        <Card>
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <Tag className="w-4 h-4 text-gold" />
            My Services
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            Set your personal duration for each service. Customers will see your actual appointment length.
          </p>

          {servicesLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
              <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
              Loading services…
            </div>
          ) : servicesError ? (
            <p className="text-sm text-red-400">{servicesError}</p>
          ) : services.length === 0 ? (
            <p className="text-sm text-gray-500">No active services found for your shop.</p>
          ) : (
            <div className="space-y-3">
              {services.map((svc) => {
                const draft     = draftDurations[svc.id] ?? String(svc.effective_duration);
                const dur       = parseInt(draft, 10);
                const blocksMin = isNaN(dur) || dur < 0 ? null : dur + bufferMinutes;
                const isSaving  = savingService === svc.id;
                const isSaved   = savedService  === svc.id;
                const err       = serviceErrors[svc.id];
                const isDirty   = dur !== svc.effective_duration;

                return (
                  <div
                    key={svc.id}
                    className="flex flex-col gap-2 p-4 rounded-xl bg-dark-200 border border-dark-300"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{svc.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">Base: {svc.base_duration} min</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <input
                          type="number"
                          value={draft}
                          min={5}
                          onChange={(e) => {
                            setDraftDurations((prev) => ({ ...prev, [svc.id]: e.target.value }));
                            setServiceErrors((prev) => ({ ...prev, [svc.id]: '' }));
                            setSavedService(null);
                          }}
                          className="w-20 px-3 py-1.5 rounded-lg bg-dark-300 border border-dark-400 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-gold"
                        />
                        <span className="text-xs text-gray-500 w-6">min</span>
                        <Button
                          size="sm"
                          loading={isSaving}
                          disabled={(!isDirty || isSaving) && !isSaving}
                          onClick={() => handleServiceSave(svc)}
                        >
                          Save
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {blocksMin !== null && (
                        <p className="text-xs text-gray-500">
                          Blocks{' '}
                          <span className="text-white font-medium">{blocksMin} min</span>
                          {' '}on the calendar{' '}
                          <span className="text-gray-600">(includes {bufferMinutes} min buffer)</span>
                        </p>
                      )}
                      {isSaved && !err && (
                        <span className="flex items-center gap-1 text-xs text-emerald-400 ml-auto">
                          <CheckCircle className="w-3.5 h-3.5" /> Saved
                        </span>
                      )}
                    </div>

                    {err && <p className="text-xs text-red-400">{err}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
