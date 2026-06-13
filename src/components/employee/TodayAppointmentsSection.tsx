'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { parseISO, format, formatDistanceToNow } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { formatDateTimeInZone, formatTimeInZone } from '@/lib/utils';
import { getTodayBoundsUTC } from '@/lib/booking-time';
import { createClient } from '@/lib/supabase/client';
import Badge from '@/components/ui/Badge';
import type { BookingWithDetails, BookingStatus } from '@/types';
import { Calendar, Clock, CheckCircle, UserX, Scissors, Pencil } from 'lucide-react';

interface Props {
  todayBookings:   BookingWithDetails[];
  nextAppointment: BookingWithDetails | null;
  timezone:        string;
  employeeId:      string;
  customerHistory: Record<string, { visitCount: number; lastVisitDate: string | null }>;
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

export default function TodayAppointmentsSection({
  todayBookings,
  nextAppointment,
  timezone,
  employeeId,
  customerHistory,
}: Props) {
  const [localStatus,      setLocalStatus]      = useState<LocalBookings>({});
  const [confirmNoShow,    setConfirmNoShow]    = useState<string | null>(null);
  const [confirmCancel,    setConfirmCancel]    = useState<string | null>(null);
  const [transitioning,    setTransitioning]    = useState<string | null>(null);
  const [cancelling,       setCancelling]       = useState<string | null>(null);
  const [transitionErrors, setTransitionErrors] = useState<Record<string, string>>({});
  const [cancelErrors,     setCancelErrors]     = useState<Record<string, string>>({});
  const [editingNotesId,   setEditingNotesId]   = useState<string | null>(null);
  const [notesDraft,       setNotesDraft]       = useState<Record<string, string>>({});
  const [notesSaving,      setNotesSaving]      = useState<string | null>(null);
  const [notesErrors,      setNotesErrors]      = useState<Record<string, string>>({});
  const [now,              setNow]              = useState(() => new Date());
  const [localBookings,    setLocalBookings]    = useState<BookingWithDetails[]>(todayBookings);
  const [localNextApt,     setLocalNextApt]     = useState<BookingWithDetails | null>(nextAppointment);
  const [highlightedIds,   setHighlightedIds]   = useState<Record<string, boolean>>({});
  const timelineRef = useRef<HTMLDivElement>(null);

  // Tick every 30 seconds so relative times and button visibility stay current
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Supabase Realtime: live booking changes for this employee
  useEffect(() => {
    if (!employeeId) return;
    const supabase = createClient();

    function flashHighlight(bookingId: string) {
      setHighlightedIds((prev) => ({ ...prev, [bookingId]: true }));
      setTimeout(() => {
        setHighlightedIds((prev) => {
          const next = { ...prev };
          delete next[bookingId];
          return next;
        });
      }, 1500);
    }

    const channel = supabase
      .channel(`employee-bookings-${employeeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `employee_id=eq.${employeeId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as BookingWithDetails;
            const { start: todayStart, end: todayEnd } = getTodayBoundsUTC(timezone);
            const bookingStart = parseISO(row.start_time);
            if (bookingStart >= todayStart && bookingStart <= todayEnd) {
              setLocalBookings((prev) => {
                if (prev.some((b) => b.id === row.id)) return prev;
                return [...prev, row].sort((a, b) => a.start_time.localeCompare(b.start_time));
              });
              flashHighlight(row.id);
              if (row.status === 'checked_in') {
                setLocalNextApt((prev) => {
                  if (!prev || bookingStart < parseISO(prev.start_time)) return row;
                  return prev;
                });
              }
            }
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as BookingWithDetails;
            setLocalBookings((prev) =>
              prev.map((b) =>
                b.id === row.id
                  ? { ...b, ...row, customer: b.customer, employee: b.employee, shop: b.shop }
                  : b
              )
            );
            setLocalNextApt((prev) => {
              if (!prev || prev.id !== row.id) return prev;
              return { ...prev, ...row, customer: prev.customer, employee: prev.employee, shop: prev.shop };
            });
            flashHighlight(row.id);
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string })?.id;
            if (!deletedId) return;
            setLocalBookings((prev) => prev.filter((b) => b.id !== deletedId));
            setLocalNextApt((prev) => (prev?.id === deletedId ? null : prev));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [employeeId, timezone]);

  function getStatus(b: BookingWithDetails): BookingStatus {
    return (localStatus[b.id] as BookingStatus | undefined) ?? b.status;
  }

  async function transition(bookingId: string, newStatus: BookingStatus) {
    setTransitioning(bookingId);
    setConfirmNoShow(null);
    setConfirmCancel(null);
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

  async function cancelBooking(bookingId: string) {
    setCancelling(bookingId);
    setConfirmCancel(null);
    setEditingNotesId(null);
    setCancelErrors((prev) => ({ ...prev, [bookingId]: '' }));
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      if (res.ok) {
        setLocalBookings((prev) => prev.filter((b) => b.id !== bookingId));
        setLocalNextApt((prev) => (prev?.id === bookingId ? null : prev));
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

  async function saveNotes(bookingId: string) {
    setNotesSaving(bookingId);
    setNotesErrors((prev) => ({ ...prev, [bookingId]: '' }));
    const notes = notesDraft[bookingId] ?? '';
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_notes', notes }),
      });
      if (res.ok) {
        setLocalBookings((prev) =>
          prev.map((b) => b.id === bookingId ? { ...b, notes } : b)
        );
        setEditingNotesId(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setNotesErrors((prev) => ({
          ...prev,
          [bookingId]: data.error ?? 'Could not save notes. Please try again.',
        }));
      }
    } catch {
      setNotesErrors((prev) => ({
        ...prev,
        [bookingId]: 'Could not save notes. Please try again.',
      }));
    }
    setNotesSaving(null);
  }

  const nowInZone = toZonedTime(now, timezone);
  const todayStr  = format(nowInZone, 'yyyy-MM-dd');

  const nextIsToday = localNextApt &&
    format(toZonedTime(parseISO(localNextApt.start_time), timezone), 'yyyy-MM-dd') === todayStr;

  const indicatorAfterIndex = localBookings.reduce((acc, b, i) => {
    const startZoned = toZonedTime(parseISO(b.start_time), timezone);
    return startZoned < nowInZone ? i : acc;
  }, -1);

  const THIRTY_MIN_MS_VAL = THIRTY_MIN_MS;
  const nextStatus = localNextApt ? getStatus(localNextApt) : null;

  return (
    <div>
      {/* ── Next Appointment highlight card ─────────────────────────────── */}
      {localNextApt ? (
        <div className="mb-6">
          <div className={`p-4 bg-dark-100 border rounded-2xl flex items-center justify-between gap-4 ${
            nextStatus === 'checked_in' ? 'border-emerald-500/30' : 'border-gold/30'
          }`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gold-muted border border-gold/20 flex items-center justify-center font-bold text-gold flex-shrink-0">
                {localNextApt.customer?.full_name?.charAt(0) ?? '?'}
              </div>
              <div>
                {nextStatus === 'checked_in' ? (
                  <div className="text-xs text-emerald-400 mb-0.5">In chair now</div>
                ) : (
                  <div className="text-xs text-gray-500 mb-0.5">Next appointment</div>
                )}
                <div className="font-semibold">{localNextApt.customer?.full_name ?? 'Unknown'}</div>
                <div className="text-xs text-gold">
                  {formatTimeInZone(localNextApt.start_time, timezone)}
                  {nextStatus === 'confirmed' && (
                    <span className="text-gray-400">
                      {' '}({timeUntil(localNextApt.start_time, timezone)})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {nextStatus === 'checked_in' ? (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => transition(localNextApt.id, 'completed')}
                  disabled={transitioning === localNextApt.id}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-medium rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Complete
                </button>
                <button
                  onClick={() => setConfirmNoShow(localNextApt.id)}
                  disabled={transitioning === localNextApt.id}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-500/10 text-gray-400 border border-gray-500/20 text-sm font-medium rounded-lg hover:bg-gray-500/20 transition-colors disabled:opacity-50"
                >
                  <UserX className="w-4 h-4" />
                  No Show
                </button>
              </div>
            ) : (
              (toZonedTime(parseISO(localNextApt.start_time), timezone).getTime() - nowInZone.getTime()) <= THIRTY_MIN_MS_VAL &&
              nextStatus === 'confirmed' && (
                <button
                  onClick={() => transition(localNextApt.id, 'checked_in')}
                  disabled={transitioning === localNextApt.id}
                  className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-gradient-gold text-dark text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Check In
                </button>
              )
            )}
          </div>

          {confirmNoShow === localNextApt.id && (
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
                  onClick={() => transition(localNextApt.id, 'no_show')}
                  className="px-3 py-1 text-xs font-medium bg-gray-500/20 text-gray-300 rounded-lg hover:bg-gray-500/30 transition-colors"
                >
                  Confirm No Show
                </button>
              </div>
            </div>
          )}

          {transitionErrors[localNextApt.id] && (
            <div className="mx-1 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-b-2xl -mt-1 text-xs text-red-400">
              {transitionErrors[localNextApt.id]}
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
        {localBookings.length > 0 && (
          <span className="text-xs text-gold bg-gold-muted px-2 py-0.5 rounded-full font-medium">
            {localBookings.length}
          </span>
        )}
      </h2>

      {localBookings.length === 0 ? (
        <div className="text-center py-8 bg-dark-100 border border-dark-300 rounded-xl">
          <Scissors className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-400">No appointments today.</p>
        </div>
      ) : (
        <div ref={timelineRef} className="space-y-2">
          {localBookings.map((b, idx) => {
            const status       = getStatus(b);
            const startZoned   = toZonedTime(parseISO(b.start_time), timezone);
            const isPast       = startZoned < nowInZone;
            const isDone       = ['completed', 'no_show', 'cancelled', 'pending_reschedule'].includes(status);
            const withinWindow = (startZoned.getTime() - nowInZone.getTime()) <= THIRTY_MIN_MS_VAL;
            const busy         = transitioning === b.id;
            const isHighlighted = highlightedIds[b.id];
            const isEditing    = editingNotesId === b.id;
            const history      = customerHistory[b.customer_id ?? ''];
            const visitCount   = history?.visitCount ?? 0;

            return (
              <div key={b.id}>
                {indicatorAfterIndex === idx && idx < localBookings.length - 1 && (
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
                      !isDone && !isPast && isHighlighted
                        ? 'bg-dark-200 border-gold/60'
                        : isDone
                        ? 'bg-dark-100/40 border-dark-300/40 opacity-60'
                        : isPast
                        ? 'bg-dark-100/50 border-dark-300/50 opacity-70'
                        : 'bg-dark-100 border-gold/20'
                    }`}
                  >
                    {/* Left: customer info */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-full bg-gold-muted border border-gold/20 flex items-center justify-center font-bold text-gold text-sm flex-shrink-0">
                        {b.customer?.full_name?.charAt(0) ?? '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{b.customer?.full_name ?? 'Unknown'}</div>
                        <div className="text-xs text-gray-500 truncate">{b.customer?.email}</div>

                        {/* Customer visit history */}
                        {visitCount === 0 ? (
                          <div className="text-xs text-emerald-400 mt-0.5">First visit</div>
                        ) : visitCount === 1 ? (
                          <div className="text-xs text-gray-500 mt-0.5">1 previous visit</div>
                        ) : (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {visitCount} previous visits
                            {history.lastVisitDate && (
                              <> · Last seen {formatDistanceToNow(parseISO(history.lastVisitDate), { addSuffix: true })}</>
                            )}
                          </div>
                        )}

                        {/* Notes display / inline editor */}
                        <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                          {isEditing ? (
                            <div>
                              <textarea
                                value={notesDraft[b.id] ?? ''}
                                onChange={(e) =>
                                  setNotesDraft((prev) => ({ ...prev, [b.id]: e.target.value }))
                                }
                                maxLength={500}
                                rows={2}
                                placeholder="Add a note…"
                                className="w-full text-xs bg-dark-300 border border-dark-400 rounded-lg px-2 py-1.5 text-gray-300 placeholder:text-gray-600 resize-none focus:outline-none focus:ring-1 focus:ring-gold"
                              />
                              <div className="flex items-center justify-between mt-1">
                                <span className="text-xs text-gray-600">
                                  {(notesDraft[b.id] ?? '').length}/500
                                </span>
                                <div className="flex gap-3">
                                  <button
                                    onClick={() => setEditingNotesId(null)}
                                    className="text-xs text-gray-500 hover:text-white transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => saveNotes(b.id)}
                                    disabled={notesSaving === b.id}
                                    className="text-xs font-medium text-gold hover:text-gold-light transition-colors disabled:opacity-50"
                                  >
                                    {notesSaving === b.id ? 'Saving…' : 'Save'}
                                  </button>
                                </div>
                              </div>
                              {notesErrors[b.id] && (
                                <div className="text-xs text-red-400 mt-0.5">{notesErrors[b.id]}</div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {b.notes ? (
                                <div className="text-xs text-gray-400 truncate flex-1">{b.notes}</div>
                              ) : (
                                <span className="text-xs text-gray-600">Add note</span>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingNotesId(b.id);
                                  setNotesDraft((prev) => ({ ...prev, [b.id]: b.notes ?? '' }));
                                  setConfirmCancel(null);
                                  setConfirmNoShow(null);
                                }}
                                aria-label="Edit notes"
                                className="text-gray-600 hover:text-gray-400 transition-colors flex-shrink-0"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: time, duration, badge, actions */}
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

                      {/* Cancel text link — only for confirmed bookings */}
                      {status === 'confirmed' && !isDone && (
                        <button
                          onClick={() => {
                            setConfirmCancel(b.id);
                            setConfirmNoShow(null);
                            setEditingNotesId(null);
                          }}
                          disabled={cancelling === b.id}
                          className="text-xs text-red-400/60 hover:text-red-400 transition-colors mt-0.5 disabled:opacity-50"
                        >
                          {cancelling === b.id ? '…' : 'Cancel'}
                        </button>
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

                {/* Inline transition error */}
                {transitionErrors[b.id] && (
                  <div className="mx-1 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-b-xl -mt-1 text-xs text-red-400">
                    {transitionErrors[b.id]}
                  </div>
                )}

                {/* Inline cancel error */}
                {cancelErrors[b.id] && (
                  <div className="mx-1 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-b-xl -mt-1 text-xs text-red-400">
                    {cancelErrors[b.id]}
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
