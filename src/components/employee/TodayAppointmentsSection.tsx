'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { parseISO, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { formatDateTimeInZone, formatTimeInZone } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import type { BookingWithDetails, BookingStatus } from '@/types';
import { Calendar, Clock, CheckCircle, UserX, Scissors } from 'lucide-react';

interface Props {
  todayBookings:   BookingWithDetails[];
  nextAppointment: BookingWithDetails | null;
  timezone:        string;
}

type LocalBookings = Record<string, BookingStatus>;

const THIRTY_MIN_MS = 30 * 60 * 1000;

function timeUntil(isoTime: string, timezone: string): string {
  const startZoned = toZonedTime(parseISO(isoTime), timezone);
  const nowZoned   = toZonedTime(new Date(), timezone);
  const diff = startZoned.getTime() - nowZoned.getTime();
  if (diff <= 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `in ${hrs}h ${rem}m` : `in ${hrs}h`;
}

export default function TodayAppointmentsSection({ todayBookings, nextAppointment, timezone }: Props) {
  const [localStatus,      setLocalStatus]      = useState<LocalBookings>({});
  const [confirmNoShow,    setConfirmNoShow]    = useState<string | null>(null);
  const [transitioning,    setTransitioning]    = useState<string | null>(null);
  const [transitionErrors, setTransitionErrors] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => new Date());
  const timelineRef = useRef<HTMLDivElement>(null);

  // Tick every 30 seconds so relative times and button visibility stay current
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  function getStatus(b: BookingWithDetails): BookingStatus {
    return (localStatus[b.id] as BookingStatus | undefined) ?? b.status;
  }

  async function transition(bookingId: string, newStatus: BookingStatus) {
    setTransitioning(bookingId);
    setConfirmNoShow(null);
    setTransitionErrors((prev) => ({ ...prev, [bookingId]: '' }));
    try {
      const res = await fetch(`/api/bookings/${bookingId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setLocalStatus((prev) => ({ ...prev, [bookingId]: newStatus }));
      } else {
        const data = await res.json().catch(() => ({}));
        setTransitionErrors((prev) => ({
          ...prev,
          [bookingId]: data.error ?? 'Could not update status. Please try again.',
        }));
      }
    } catch {
      setTransitionErrors((prev) => ({
        ...prev,
        [bookingId]: 'Could not update status. Please try again.',
      }));
    }
    setTransitioning(null);
  }

  // Express "now" in the shop's timezone — all time comparisons below use
  // shop-local time so they are correct regardless of the client's OS timezone.
  const nowInZone  = toZonedTime(now, timezone);
  const todayStr   = format(nowInZone, 'yyyy-MM-dd');

  const nextIsToday = nextAppointment &&
    format(toZonedTime(parseISO(nextAppointment.start_time), timezone), 'yyyy-MM-dd') === todayStr;

  // Time indicator: find the last booking whose start is before now (shop time)
  const indicatorAfterIndex = todayBookings.reduce((acc, b, i) => {
    const startZoned = toZonedTime(parseISO(b.start_time), timezone);
    return startZoned < nowInZone ? i : acc;
  }, -1);

  const THIRTY_MIN_MS_VAL = THIRTY_MIN_MS;

  // Effective status for the highlight card (respects optimistic local overrides)
  const nextStatus = nextAppointment ? getStatus(nextAppointment) : null;

  return (
    <div>
      {/* ── Next Appointment highlight card ─────────────────────────────── */}
      {nextAppointment ? (
        <div className="mb-6">
          <div className={`p-4 bg-dark-100 border rounded-2xl flex items-center justify-between gap-4 ${
            nextStatus === 'checked_in' ? 'border-emerald-500/30' : 'border-gold/30'
          }`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gold-muted border border-gold/20 flex items-center justify-center font-bold text-gold flex-shrink-0">
                {nextAppointment.customer?.full_name?.charAt(0) ?? '?'}
              </div>
              <div>
                {nextStatus === 'checked_in' ? (
                  <div className="text-xs text-emerald-400 mb-0.5">In chair now</div>
                ) : (
                  <div className="text-xs text-gray-500 mb-0.5">Next appointment</div>
                )}
                <div className="font-semibold">{nextAppointment.customer?.full_name ?? 'Unknown'}</div>
                <div className="text-xs text-gold">
                  {formatTimeInZone(nextAppointment.start_time, timezone)}
                  {nextStatus === 'confirmed' && (
                    <span className="text-gray-400">
                      {' '}({timeUntil(nextAppointment.start_time, timezone)})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Action buttons vary by effective status */}
            {nextStatus === 'checked_in' ? (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => transition(nextAppointment.id, 'completed')}
                  disabled={transitioning === nextAppointment.id}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-medium rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Complete
                </button>
                <button
                  onClick={() => setConfirmNoShow(nextAppointment.id)}
                  disabled={transitioning === nextAppointment.id}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-500/10 text-gray-400 border border-gray-500/20 text-sm font-medium rounded-lg hover:bg-gray-500/20 transition-colors disabled:opacity-50"
                >
                  <UserX className="w-4 h-4" />
                  No Show
                </button>
              </div>
            ) : (
              // Check In button: appears within 30 min of start (shop timezone)
              (toZonedTime(parseISO(nextAppointment.start_time), timezone).getTime() - nowInZone.getTime()) <= THIRTY_MIN_MS_VAL &&
              nextStatus === 'confirmed' && (
                <button
                  onClick={() => transition(nextAppointment.id, 'checked_in')}
                  disabled={transitioning === nextAppointment.id}
                  className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-gradient-gold text-dark text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Check In
                </button>
              )
            )}
          </div>

          {/* No-show confirmation for highlight card */}
          {confirmNoShow === nextAppointment.id && (
            <div className="mx-1 px-4 py-3 bg-dark-200 border border-gray-500/20 rounded-b-2xl -mt-1 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-400">Mark this customer as a no show?</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmNoShow(null)}
                  className="px-3 py-1 text-xs text-gray-500 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => transition(nextAppointment.id, 'no_show')}
                  className="px-3 py-1 text-xs font-medium bg-gray-500/20 text-gray-300 rounded-lg hover:bg-gray-500/30 transition-colors"
                >
                  Confirm No Show
                </button>
              </div>
            </div>
          )}

          {/* Inline transition error for highlight card */}
          {transitionErrors[nextAppointment.id] && (
            <div className="mx-1 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-b-2xl -mt-1 text-xs text-red-400">
              {transitionErrors[nextAppointment.id]}
            </div>
          )}
        </div>
      ) : nextIsToday === false ? (
        <div className="mb-6 p-4 bg-dark-100 border border-dark-300 rounded-2xl text-center text-sm text-gray-500">
          No more appointments today.
        </div>
      ) : null}

      {/* ── Today's appointments ─────────────────────────────────────────── */}
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Calendar className="w-5 h-5 text-gold" />
        Today&apos;s Appointments
        {todayBookings.length > 0 && (
          <span className="text-xs text-gold bg-gold-muted px-2 py-0.5 rounded-full font-medium">
            {todayBookings.length}
          </span>
        )}
      </h2>

      {todayBookings.length === 0 ? (
        <div className="text-center py-8 bg-dark-100 border border-dark-300 rounded-xl">
          <Scissors className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-400">No appointments today.</p>
        </div>
      ) : (
        <div ref={timelineRef} className="space-y-2">
          {todayBookings.map((b, idx) => {
            const status       = getStatus(b);
            const startZoned   = toZonedTime(parseISO(b.start_time), timezone);
            const isPast       = startZoned < nowInZone;
            const isDone       = ['completed', 'no_show', 'cancelled', 'pending_reschedule'].includes(status);
            const withinWindow = (startZoned.getTime() - nowInZone.getTime()) <= THIRTY_MIN_MS_VAL;
            const busy         = transitioning === b.id;

            return (
              <div key={b.id}>
                {/* Time indicator line — position determined by shop-local time */}
                {indicatorAfterIndex === idx && idx < todayBookings.length - 1 && (
                  <div className="flex items-center gap-2 my-1">
                    <div className="flex-1 h-px bg-gold/40" />
                    <div className="flex items-center gap-1 text-xs text-gold/70">
                      <Clock className="w-3 h-3" />
                      now
                    </div>
                    <div className="flex-1 h-px bg-gold/40" />
                  </div>
                )}

                <Link href={`/booking/${b.id}`} className="block">
                  <div
                    className={`flex items-start justify-between p-4 rounded-xl border transition-all ${
                      isDone
                        ? 'bg-dark-100/40 border-dark-300/40 opacity-60'
                        : isPast
                        ? 'bg-dark-100/50 border-dark-300/50 opacity-70'
                        : 'bg-dark-100 border-gold/20'
                    }`}
                  >
                    {/* Left: customer info */}
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-gold-muted border border-gold/20 flex items-center justify-center font-bold text-gold text-sm flex-shrink-0">
                        {b.customer?.full_name?.charAt(0) ?? '?'}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{b.customer?.full_name ?? 'Unknown'}</div>
                        <div className="text-xs text-gray-500 truncate">{b.customer?.email}</div>
                        {b.notes && (
                          <div className="text-xs text-gray-400 mt-0.5 truncate">{b.notes}</div>
                        )}
                      </div>
                    </div>

                    {/* Right: time, duration, badge, actions — stopPropagation prevents card link from firing on button tap */}
                    <div
                      className="flex flex-col items-end gap-1 flex-shrink-0 ml-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className={`font-semibold text-sm ${isPast && !isDone ? 'text-gray-400' : 'text-gold'}`}>
                        {formatDateTimeInZone(b.start_time, timezone).split('•')[1]?.trim()}
                      </div>
                      <div className="text-xs text-gray-500">{b.service_duration_minutes ?? 25} min</div>
                      <Badge status={status} />
                      {status === 'pending_reschedule' && (
                        <div className="text-xs text-amber-400 text-right mt-0.5">Awaiting customer reschedule — slot freed</div>
                      )}

                      {!isDone && (
                        <div className="flex gap-2 mt-1">
                          {status === 'confirmed' && (withinWindow || isPast) && (
                            <button
                              onClick={() => transition(b.id, 'checked_in')}
                              disabled={busy}
                              className="flex items-center gap-1 px-4 py-2.5 text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-lg hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
                            >
                              <CheckCircle className="w-3 h-3" />
                              {busy ? '…' : 'Check In'}
                            </button>
                          )}
                          {status === 'checked_in' && (
                            <>
                              <button
                                onClick={() => transition(b.id, 'completed')}
                                disabled={busy}
                                className="flex items-center gap-1 px-4 py-2.5 text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                              >
                                <CheckCircle className="w-3 h-3" />
                                {busy ? '…' : 'Complete'}
                              </button>
                              <button
                                onClick={() => setConfirmNoShow(b.id)}
                                disabled={busy}
                                className="flex items-center gap-1 px-4 py-2.5 text-xs font-medium bg-gray-500/10 text-gray-400 border border-gray-500/20 rounded-lg hover:bg-gray-500/20 transition-colors disabled:opacity-50"
                              >
                                <UserX className="w-3 h-3" />
                                No Show
                              </button>
                            </>
                          )}
                          {/* Direct no-show from confirmed past appointments — Fix 2: removed dead !withinWindow guard */}
                          {status === 'confirmed' && isPast && (
                            <button
                              onClick={() => setConfirmNoShow(b.id)}
                              disabled={busy}
                              className="flex items-center gap-1 px-4 py-2.5 text-xs font-medium bg-gray-500/10 text-gray-400 border border-gray-500/20 rounded-lg hover:bg-gray-500/20 transition-colors disabled:opacity-50"
                            >
                              <UserX className="w-3 h-3" />
                              No Show
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>

                {/* No-show confirmation inline */}
                {confirmNoShow === b.id && (
                  <div className="mx-1 px-4 py-3 bg-dark-200 border border-gray-500/20 rounded-b-xl -mt-1 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">Mark this customer as a no show?</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmNoShow(null)}
                        className="px-3 py-1 text-xs text-gray-500 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => transition(b.id, 'no_show')}
                        className="px-3 py-1 text-xs font-medium bg-gray-500/20 text-gray-300 rounded-lg hover:bg-gray-500/30 transition-colors"
                      >
                        Confirm No Show
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline transition error */}
                {transitionErrors[b.id] && (
                  <div className="mx-1 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-b-xl -mt-1 text-xs text-red-400">
                    {transitionErrors[b.id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
