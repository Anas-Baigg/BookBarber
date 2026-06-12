'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateTimeInZone, formatTimeInZone, formatDateInZone } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Navbar from '@/components/layout/Navbar';
import type { BookingWithDetails, Role, TimeSlot } from '@/types';
import { addDays, format, parseISO, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { CheckCircle, AlertTriangle, Calendar, Clock, MapPin, User, Scissors } from 'lucide-react';

interface Props {
  booking:  BookingWithDetails;
  userRole: Role;
}

export default function BookingDetailClient({ booking: initialBooking, userRole }: Props) {
  const router    = useRouter();
  const bookingId = initialBooking.id;

  const [booking,             setBooking]             = useState(initialBooking);
  // mode starts at 'view' for all statuses — pending_reschedule no longer auto-opens reschedule
  const [mode,                setMode]                = useState<'view' | 'reschedule'>('view');
  const [rescheduleBarber,    setRescheduleBarber]    = useState<string>('any');
  const [rescheduleEmployees, setRescheduleEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [slots,               setSlots]               = useState<TimeSlot[]>([]);
  const [selectedSlot,        setSelectedSlot]        = useState<TimeSlot | null>(null);
  const [selectedDate,        setSelectedDate]        = useState('');
  const [loadingSlots,        setLoadingSlots]        = useState(false);
  const [saving,              setSaving]              = useState(false);
  const [error,               setError]               = useState('');
  const [slotError,           setSlotError]           = useState('');
  const [sessionExpired,      setSessionExpired]      = useState(false);
  // Only load employees when service_id is known — legacy bookings omit the barber picker
  const canChangeBarber = !!initialBooking.service_id;
  const [loadingEmployees,    setLoadingEmployees]    = useState(
    initialBooking.status === 'pending_reschedule' && !!initialBooking.shop?.id && canChangeBarber
  );

  const timezone            = booking.shop?.timezone ?? 'UTC';
  const isCancelled         = booking.status === 'cancelled';
  const isPendingReschedule = booking.status === 'pending_reschedule';
  const isCheckedIn         = booking.status === 'checked_in';
  const isCompleted         = booking.status === 'completed';
  const isNoShow            = booking.status === 'no_show';
  const canCancelOrReschedule = booking.status === 'confirmed' || booking.status === 'rescheduled';

  const [today, setToday] = useState(() => startOfDay(new Date()));
  useEffect(() => {
    const interval = setInterval(() => {
      const newToday = startOfDay(new Date());
      if (newToday.getTime() !== today.getTime()) setToday(newToday);
    }, 60_000);
    return () => clearInterval(interval);
  }, [today]);

  const availableDates = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => {
      const d = addDays(today, i);
      return format(toZonedTime(d, timezone), 'yyyy-MM-dd');
    }),
    [today, timezone]
  );

  // Ref for aborting in-flight slot fetches when the user rapidly switches dates
  const slotFetchController = useRef<AbortController | null>(null);

  // Load employees on mount when pending_reschedule so Option A is ready immediately.
  // Uses /api/employees/available instead of a direct table query (Fix 5).
  // Skipped for legacy bookings with no service_id — those show no barber picker.
  useEffect(() => {
    if (initialBooking.status !== 'pending_reschedule' || !initialBooking.shop?.id) return;
    if (!canChangeBarber) {
      // Lock to the assigned barber — no picker needed
      setRescheduleBarber(initialBooking.employee_id ?? 'any');
      return;
    }
    const serviceId = initialBooking.service_id!;
    const params = new URLSearchParams({ shopId: initialBooking.shop.id, serviceId });
    fetch(`/api/employees/available?${params}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { setRescheduleEmployees(data ?? []); setLoadingEmployees(false); })
      .catch(() => setLoadingEmployees(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchRescheduleSlots(date: string, barber?: string) {
    if (!booking.shop?.id) return;

    // Abort any previous in-flight fetch before starting a new one
    slotFetchController.current?.abort();
    const controller = new AbortController();
    slotFetchController.current = controller;

    const resolvedBarber = barber ?? rescheduleBarber;
    setLoadingSlots(true);
    setSlots([]);
    setSelectedSlot(null);
    setSlotError('');
    try {
      let serviceId: string | null = booking.service_id;
      if (!serviceId) {
        // Legacy booking (pre-migration-014, no service_id) — fall back to the shop's first active service
        const svcRes = await fetch(`/api/services?shopId=${booking.shop.id}`, { signal: controller.signal });
        if (svcRes.ok) {
          const svcs: { id: string }[] = await svcRes.json();
          serviceId = svcs[0]?.id ?? null;
        }
      }
      if (!serviceId) {
        if (!controller.signal.aborted) {
          setSlotError('Unable to load available times. Please contact the shop to reschedule.');
        }
        return;
      }
      const params = new URLSearchParams({ shopId: booking.shop.id, date, employeeId: resolvedBarber, serviceId });
      const res = await fetch(`/api/slots?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to load slots');
      if (!controller.signal.aborted) setSlots(await res.json());
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setSlots([]);
      setSlotError('Could not load available times. Please try again.');
    } finally {
      if (!controller.signal.aborted) setLoadingSlots(false);
    }
  }

  // Fix 2: when the barber selection changes, reset date and slots
  function handleRescheduleBarberChange(barber: string) {
    setRescheduleBarber(barber);
    setSelectedDate('');
    setSlots([]);
    setSelectedSlot(null);
    setSlotError('');
  }

  // Fix 2: enter reschedule mode for normal (confirmed/rescheduled) bookings
  async function enterRescheduleMode() {
    setMode('reschedule');
    setSelectedDate('');
    setSlots([]);
    setSelectedSlot(null);
    setError('');

    const serviceId = booking.service_id;
    if (!serviceId) {
      // Legacy booking — lock to the assigned barber, no picker
      setRescheduleBarber(booking.employee_id ?? 'any');
      return;
    }

    setRescheduleBarber('any');
    if (rescheduleEmployees.length === 0 && booking.shop?.id) {
      setLoadingEmployees(true);
      try {
        const params = new URLSearchParams({ shopId: booking.shop.id, serviceId });
        const res = await fetch(`/api/employees/available?${params}`);
        const data = res.ok ? await res.json() : [];
        setRescheduleEmployees(data ?? []);
      } catch {
        // leave empty — "any available" still works
      } finally {
        setLoadingEmployees(false);
      }
    }
  }

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel? This cannot be undone.')) return;
    setSaving(true);
    setError('');
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'cancel' }),
    });
    // Fix 3: session expired
    if (res.status === 401) {
      setSessionExpired(true);
      setSaving(false);
      return;
    }
    if (res.ok) {
      setBooking((b) => ({ ...b, status: 'cancelled' }));
      router.refresh();
    } else {
      setError('Failed to cancel booking.');
    }
    setSaving(false);
  }

  async function handleReschedule() {
    if (!selectedSlot) return;
    setSaving(true);
    setError('');
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action:    'reschedule',
        startTime: selectedSlot.start,
        endTime:   selectedSlot.end,
        // Fix 2: always pass newEmployeeId so barber changes work in both flows
        ...(selectedSlot.employeeId ? { newEmployeeId: selectedSlot.employeeId } : {}),
      }),
    });
    // Fix 3: session expired
    if (res.status === 401) {
      setSessionExpired(true);
      setSaving(false);
      return;
    }
    if (res.ok) {
      const updated = await res.json();
      setBooking((b) => ({ ...b, ...updated }));
      setMode('view');
      setSelectedSlot(null);
      router.refresh();
    } else {
      const data = await res.json();
      setError(data.error ?? 'Reschedule failed.');
    }
    setSaving(false);
  }

  // ── Shared reschedule sub-sections (used by both pending and normal flows) ──

  // Legacy bookings have no service_id — hide the barber picker and keep the assigned barber
  const barberPickerJsx = canChangeBarber ? (
    <div className="mb-4">
      <label className="text-xs text-gray-400 block mb-2">Select barber</label>
      {loadingEmployees ? (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <div className="w-3 h-3 border-2 border-gold border-t-transparent rounded-full animate-spin flex-shrink-0" />
          Loading barbers…
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleRescheduleBarberChange('any')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              rescheduleBarber === 'any'
                ? 'border-gold bg-gold-muted text-gold'
                : 'border-dark-400 hover:border-dark-500 text-white'
            }`}
          >
            Any available
          </button>
          {rescheduleEmployees.map((emp) => (
            <button
              key={emp.id}
              onClick={() => handleRescheduleBarberChange(emp.id)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                rescheduleBarber === emp.id
                  ? 'border-gold bg-gold-muted text-gold'
                  : 'border-dark-400 hover:border-dark-500 text-white'
              }`}
            >
              {emp.name}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null;

  const datePickerJsx = (
    <div className="mb-4">
      <label className="text-xs text-gray-400 block mb-2">Select date</label>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
        {availableDates.slice(0, 14).map((date) => {
          const d = new Date(date + 'T12:00:00');
          return (
            <button
              key={date}
              onClick={() => { setSelectedDate(date); fetchRescheduleSlots(date); }}
              className={`flex flex-col items-center py-2 rounded-lg border text-xs transition-all ${
                selectedDate === date
                  ? 'border-gold bg-gold-muted text-gold'
                  : 'border-dark-400 hover:border-dark-500 text-white'
              }`}
            >
              <span className="text-gray-500">{format(d, 'EEE')}</span>
              <span className="font-bold">{format(d, 'd')}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const slotPickerJsx = selectedDate ? (
    <div className="mb-4">
      <label className="text-xs text-gray-400 block mb-2">Select time</label>
      {loadingSlots ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
          <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          Loading slots…
        </div>
      ) : slotError ? (
        <div className="py-2">
          <p className="text-sm text-red-400 mb-2">{slotError}</p>
          <button
            onClick={() => fetchRescheduleSlots(selectedDate)}
            className="text-xs text-gold underline font-medium hover:opacity-80 transition-opacity"
          >
            Try again
          </button>
        </div>
      ) : slots.length === 0 ? (
        <p className="text-sm text-gray-400">No slots available on this date.</p>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
          {slots.map((slot) => (
            <button
              key={slot.start}
              onClick={() => setSelectedSlot(slot)}
              className={`py-2 rounded-lg border text-xs font-medium transition-all ${
                selectedSlot?.start === slot.start ? 'slot-selected' : 'slot-available'
              }`}
            >
              {formatTimeInZone(slot.start, timezone)}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null;

  // Fix 3: session-expired banner shown near action areas
  const sessionExpiredJsx = sessionExpired ? (
    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-4">
      <p className="text-sm text-amber-400 font-medium mb-3">
        Your session has expired. Please sign in again.
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => router.push(`/auth/login?returnTo=/booking/${bookingId}`)}
      >
        Sign In
      </Button>
    </div>
  ) : null;

  const errorJsx = (error && !sessionExpired) ? (
    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
      {error}
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 pt-24 pb-16">

        {/* Confirmed banner */}
        {booking.status === 'confirmed' && (
          <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl mb-6">
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
            <div>
              <div className="font-medium text-green-400">Booking Confirmed</div>
              <div className="text-xs text-green-400/70">A confirmation was sent to your email.</div>
            </div>
          </div>
        )}

        {/* Fix 1: pending_reschedule banner — replaces old "Action Required" banner */}
        {isPendingReschedule && (
          <div className="flex items-start gap-3 p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl mb-6">
            <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-orange-400">Action Required</div>
              <div className="text-sm text-orange-400/80 mt-1">
                Your barber is unavailable for your original appointment on{' '}
                <strong>{formatDateTimeInZone(booking.start_time, timezone)}</strong>.
                Please choose what you would like to do.
                {booking.reschedule_deadline && (
                  <> Deadline:{' '}
                    <strong>
                      {format(toZonedTime(parseISO(booking.reschedule_deadline), timezone), 'MMM d, h:mm a')}
                    </strong>.
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="bg-dark-100 border border-dark-300 rounded-2xl overflow-hidden">

          {/* Header */}
          <div className="p-6 border-b border-dark-300 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Scissors className="w-4 h-4 text-gold" />
                <span className="font-bold text-lg">{booking.shop?.name}</span>
              </div>
              <code className="text-xs text-gray-500">#{bookingId.slice(0, 8).toUpperCase()}</code>
            </div>
            <Badge status={booking.status} />
          </div>

          {/* Details */}
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-dark-300 flex items-center justify-center">
                  <User className="w-4 h-4 text-gold" />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Barber</div>
                  <div className="font-medium text-sm">{booking.employee?.name ?? 'Unassigned'}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-dark-300 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-gold" />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Date</div>
                  <div className="font-medium text-sm">
                    {formatDateInZone(booking.start_time, timezone)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-dark-300 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-gold" />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Time</div>
                  <div className="font-medium text-sm text-gold">
                    {formatTimeInZone(booking.start_time, timezone)} —{' '}
                    {formatTimeInZone(booking.end_time, timezone)}
                  </div>
                </div>
              </div>
              {booking.shop?.address && (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-dark-300 flex items-center justify-center">
                    <MapPin className="w-4 h-4 text-gold" />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-0.5">Location</div>
                    <div className="font-medium text-sm">{booking.shop.address}</div>
                  </div>
                </div>
              )}
            </div>
            {booking.notes && (
              <div className="p-3 bg-dark-200 rounded-lg text-sm text-gray-300 border border-dark-400">
                <span className="text-gray-500 text-xs block mb-1">Notes</span>
                {booking.notes}
              </div>
            )}
          </div>

          {/* ── Fix 1: pending_reschedule — two equal options ──────────────── */}
          {isPendingReschedule && userRole !== 'employee' && (
            <>
              {/* Option A — Reschedule */}
              <div className="p-6 border-t border-dark-300">
                <h3 className="font-semibold mb-1 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gold" />
                  Option A — Reschedule
                </h3>
                <p className="text-xs text-gray-400 mb-4">
                  Choose a new barber, date, and time. Your booking will be confirmed immediately.
                </p>
                {barberPickerJsx}
                {datePickerJsx}
                {slotPickerJsx}
                {errorJsx}
                {sessionExpiredJsx}
                <Button onClick={handleReschedule} disabled={!selectedSlot || saving} loading={saving}>
                  Confirm Reschedule
                </Button>
              </div>

              {/* OR divider */}
              <div className="flex items-center gap-4 px-6">
                <div className="flex-1 h-px bg-dark-300" />
                <span className="text-xs text-gray-500 font-medium">OR</span>
                <div className="flex-1 h-px bg-dark-300" />
              </div>

              {/* Option B — Cancel */}
              <div className="p-6">
                <h3 className="font-semibold mb-1 text-red-400">Option B — Cancel</h3>
                <p className="text-xs text-gray-400 mb-4">
                  If you prefer not to reschedule, you can cancel this appointment.
                  You will receive a cancellation confirmation by email.
                </p>
                {sessionExpired && sessionExpiredJsx}
                <Button variant="danger" onClick={handleCancel} loading={saving}>
                  Cancel This Appointment
                </Button>
              </div>
            </>
          )}

          {/* ── Actions for confirmed / rescheduled ───────────────────────── */}
          {userRole !== 'employee' && mode === 'view' && (
            <>
              {canCancelOrReschedule && (
                <div className="p-6 border-t border-dark-300 flex gap-3">
                  <Button variant="secondary" size="sm" onClick={enterRescheduleMode}>
                    Reschedule
                  </Button>
                  <Button variant="danger" size="sm" onClick={handleCancel} loading={saving}>
                    Cancel Booking
                  </Button>
                </div>
              )}
              {isCheckedIn && (
                <div className="p-4 border-t border-dark-300">
                  <p className="text-xs text-blue-400 text-center">This appointment is currently in progress.</p>
                </div>
              )}
              {isCompleted && (
                <div className="p-4 border-t border-dark-300">
                  <p className="text-xs text-green-400 text-center">This appointment has been completed.</p>
                </div>
              )}
              {isNoShow && (
                <div className="p-4 border-t border-dark-300">
                  <p className="text-xs text-gray-400 text-center">This appointment was marked as no show.</p>
                </div>
              )}
              {/* Fix 3: session expired shown near action area in view mode */}
              {sessionExpired && (
                <div className="p-4 border-t border-dark-300">
                  {sessionExpiredJsx}
                </div>
              )}
            </>
          )}

          {/* Employee read-only notice */}
          {userRole === 'employee' && !isCancelled && (
            <div className="p-4 border-t border-dark-300">
              <p className="text-xs text-gray-500 text-center">
                View-only. Manage this booking from your schedule dashboard.
              </p>
            </div>
          )}

          {/* ── Fix 2: normal reschedule panel with barber selector ────────── */}
          {userRole !== 'employee' && mode === 'reschedule' && (
            <div className="p-6 border-t border-dark-300">
              <h3 className="font-semibold mb-4">Choose a new barber, date &amp; time</h3>
              {barberPickerJsx}
              {datePickerJsx}
              {slotPickerJsx}
              {errorJsx}
              {sessionExpiredJsx}
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={() => { setMode('view'); setSelectedSlot(null); setError(''); }}
                >
                  Cancel
                </Button>
                <Button onClick={handleReschedule} disabled={!selectedSlot || saving} loading={saving}>
                  Confirm Reschedule
                </Button>
              </div>
            </div>
          )}

        </div>

        <div className="mt-6 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(userRole === 'admin' ? '/admin/bookings' : userRole === 'employee' ? '/employee' : '/dashboard')}
          >
            ← Back to Dashboard
          </Button>
        </div>
      </main>
    </div>
  );
}
