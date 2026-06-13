'use client';

import { useState } from 'react';
import { format, addDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { formatDateTimeInZone } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import type { BookingWithDetails } from '@/types';
import { Clock, AlertTriangle } from 'lucide-react';

interface Props {
  upcomingBookings: BookingWithDetails[];
  timezone:         string;
}

function formatGroupHeading(dateStr: string, timezone: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const tomorrow = format(toZonedTime(new Date(Date.now() + 86400000), timezone), 'yyyy-MM-dd');
  const label = format(d, 'EEEE, MMMM d');
  if (dateStr === tomorrow) return `Tomorrow — ${label}`;
  return label;
}

export default function UpcomingAppointmentsSection({ upcomingBookings, timezone }: Props) {
  const [showAll,      setShowAll]      = useState(false);
  const [localBookings, setLocalBookings] = useState<BookingWithDetails[]>(upcomingBookings);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelling,    setCancelling]    = useState<string | null>(null);
  const [cancelErrors,  setCancelErrors]  = useState<Record<string, string>>({});

  async function cancelBooking(bookingId: string) {
    setCancelling(bookingId);
    setConfirmCancel(null);
    setCancelErrors((prev) => ({ ...prev, [bookingId]: '' }));
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      if (res.ok) {
        setLocalBookings((prev) => prev.filter((b) => b.id !== bookingId));
      } else {
        const data = await res.json().catch(() => ({}));
        setCancelErrors((prev) => ({
          ...prev,
          [bookingId]: data.error ?? 'Could not cancel booking. Please try again.',
        }));
      }
    } catch {
      setCancelErrors((prev) => ({
        ...prev,
        [bookingId]: 'Could not cancel booking. Please try again.',
      }));
    }
    setCancelling(null);
  }

  const pending   = localBookings.filter((b) => b.status === 'pending_reschedule');
  const confirmed = localBookings.filter((b) => b.status !== 'pending_reschedule');

  const groups: Record<string, BookingWithDetails[]> = {};
  for (const b of confirmed) {
    const day = format(toZonedTime(new Date(b.start_time), timezone), 'yyyy-MM-dd');
    (groups[day] ??= []).push(b);
  }
  const sortedDays = Object.keys(groups).sort();

  const cutoffDate = format(toZonedTime(addDays(new Date(), 14), timezone), 'yyyy-MM-dd');
  const visibleDays = showAll ? sortedDays : sortedDays.filter((d) => d <= cutoffDate);
  const hiddenDays  = sortedDays.filter((d) => d > cutoffDate);
  const hiddenCount = hiddenDays.reduce((sum, d) => sum + groups[d].length, 0);

  if (pending.length === 0 && confirmed.length === 0) return null;

  return (
    <div className="mb-8 space-y-6">
      {/* Pending customer action — always fully shown, not subject to 14-day fold */}
      {pending.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2 text-orange-400">
            <AlertTriangle className="w-4 h-4" />
            Pending Customer Action
          </h2>
          <div className="space-y-2">
            {pending.map((b) => (
              <div
                key={b.id}
                className="flex items-start justify-between p-4 bg-orange-500/5 border border-orange-500/20 rounded-xl"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-xs font-medium text-orange-400 flex-shrink-0">
                    {b.customer?.full_name?.charAt(0) ?? '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{b.customer?.full_name ?? 'Unknown'}</div>
                    <div className="text-xs text-orange-400">{formatDateTimeInZone(b.start_time, timezone)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      This appointment is awaiting customer reschedule. The slot has been freed.
                    </div>
                    {b.notes && (
                      <div className="text-xs text-gray-400 mt-0.5">{b.notes}</div>
                    )}
                  </div>
                </div>
                <Badge status="pending_reschedule" className="flex-shrink-0 ml-2" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming appointments grouped by date — first 14 days by default */}
      {confirmed.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-gold" />
            Upcoming Appointments
          </h2>
          <div className="space-y-5">
            {visibleDays.map((day) => (
              <div key={day}>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
                  {formatGroupHeading(day, timezone)}
                </div>
                <div className="space-y-2">
                  {groups[day].map((b) => (
                    <div key={b.id}>
                      <div className="flex items-start justify-between p-4 bg-dark-100 border border-dark-300 rounded-xl">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-dark-300 flex items-center justify-center text-sm font-medium flex-shrink-0">
                            {b.customer?.full_name?.charAt(0) ?? '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{b.customer?.full_name ?? 'Unknown'}</div>
                            <div className="text-xs text-gold">{formatDateTimeInZone(b.start_time, timezone)}</div>
                            {b.notes && (
                              <div className="text-xs text-gray-400 mt-0.5 truncate">{b.notes}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                          <Badge status={b.status} />
                          {(b.status === 'confirmed' || b.status === 'rescheduled') && (
                            <button
                              onClick={() => setConfirmCancel(confirmCancel === b.id ? null : b.id)}
                              disabled={cancelling === b.id}
                              className="text-xs text-red-400/60 hover:text-red-400 transition-colors disabled:opacity-50"
                            >
                              {cancelling === b.id ? '…' : 'Cancel'}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Cancel confirmation inline */}
                      {confirmCancel === b.id && (
                        <div className="mx-1 px-4 py-3 bg-dark-200 border border-red-500/20 rounded-b-xl -mt-1 flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-400">Cancel this appointment? This cannot be undone.</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setConfirmCancel(null)}
                              className="px-3 py-1 text-xs text-gray-500 hover:text-white transition-colors"
                            >
                              Keep it
                            </button>
                            <button
                              onClick={() => cancelBooking(b.id)}
                              className="px-3 py-1 text-xs font-medium bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                            >
                              Yes, Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Inline cancel error */}
                      {cancelErrors[b.id] && (
                        <div className="mx-1 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-b-xl -mt-1 text-xs text-red-400">
                          {cancelErrors[b.id]}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAll((prev) => !prev)}
              className="mt-4 w-full py-2.5 text-sm text-gray-400 hover:text-white border border-dark-300 hover:border-dark-200 rounded-xl transition-colors"
            >
              {showAll
                ? 'Show less'
                : `Show ${hiddenCount} more appointment${hiddenCount !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
