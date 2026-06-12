'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { formatDateTimeInZone, formatTimeInZone } from '@/lib/utils';
import type { BookingWithDetails, Shop, BookingStatus, TimeSlot } from '@/types';
import { CalendarRange, Search, RotateCcw, X, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, format } from 'date-fns';

const TEN_MIN_MS  = 10 * 60 * 1000;
const PAGE_LIMIT  = 25;
const SEARCH_DEBOUNCE_MS = 400;

function withinUndoWindow(noShowSetAt: string | null | undefined): boolean {
  if (!noShowSetAt) return false;
  return Date.now() - new Date(noShowSetAt).getTime() <= TEN_MIN_MS;
}

export default function AdminBookingsPage() {
  const supabase = createClient();
  const [bookings, setBookings]             = useState<BookingWithDetails[]>([]);
  const [shops, setShops]                   = useState<Shop[]>([]);
  const [loading, setLoading]               = useState(true);
  const [totalCount, setTotalCount]         = useState(0);
  const [totalPages, setTotalPages]         = useState(1);
  const [page, setPage]                     = useState(1);
  const [filterShop, setFilterShop]         = useState('');
  const [filterStatus, setFilterStatus]     = useState<BookingStatus | ''>('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo]     = useState('');
  // search is the committed value that triggers fetch; searchInput is the live input value
  const [search, setSearch]                 = useState('');
  const [searchInput, setSearchInput]       = useState('');
  const [saving, setSaving]                 = useState<string | null>(null);
  const [, setTick]                         = useState(0);

  // Reschedule modal state
  const [rescheduleBooking, setRescheduleBooking]       = useState<BookingWithDetails | null>(null);
  const [rescheduleStep, setRescheduleStep]             = useState<1 | 2 | 3>(1);
  const [rescheduleEmployees, setRescheduleEmployees]   = useState<{ id: string; name: string }[]>([]);
  const [rescheduleEmployeeId, setRescheduleEmployeeId] = useState<string>('any');
  const [rescheduleDate, setRescheduleDate]             = useState('');
  const [rescheduleSlots, setRescheduleSlots]           = useState<TimeSlot[]>([]);
  const [rescheduleSlot, setRescheduleSlot]             = useState<TimeSlot | null>(null);
  const [loadingEmp, setLoadingEmp]                     = useState(false);
  const [loadingSlots, setLoadingSlots]                 = useState(false);
  const [rescheduleSaving, setRescheduleSaving]         = useState(false);
  const [rescheduleError, setRescheduleError]           = useState('');
  const [toast, setToast]                               = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tick every 30s so undo buttons disappear at the right time
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Load shop list once (for the shop filter dropdown)
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data } = await supabase
        .from('shops').select('id, name').eq('owner_id', session.user.id).is('deleted_at', null);
      setShops((data ?? []) as Shop[]);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchBookings = useCallback(async (targetPage: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(targetPage), limit: String(PAGE_LIMIT) });
    if (filterShop)     params.set('shopId',    filterShop);
    if (filterStatus)   params.set('status',    filterStatus);
    if (filterDateFrom) params.set('startDate', filterDateFrom);
    if (filterDateTo)   params.set('endDate',   filterDateTo);
    if (search)         params.set('search',    search);

    const res = await fetch(`/api/admin/bookings?${params}`);
    if (res.ok) {
      const { bookings: rows, totalCount: tc, page: p, totalPages: tp } = await res.json();
      setBookings(rows);
      setTotalCount(tc);
      setPage(p);
      setTotalPages(tp);
    }
    setLoading(false);
  }, [filterShop, filterStatus, filterDateFrom, filterDateTo, search]);

  useEffect(() => { fetchBookings(1); }, [fetchBookings]);

  // Debounce search input → commits to `search` state after 400 ms
  function handleSearchInput(value: string) {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleCancel(bookingId: string) {
    setSaving(bookingId);
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    if (res.ok) {
      setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, status: 'cancelled' } : b));
    }
    setSaving(null);
  }

  async function handleStatusTransition(bookingId: string, newStatus: BookingStatus) {
    setSaving(bookingId);
    const res = await fetch(`/api/bookings/${bookingId}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      const updated = await res.json();
      setBookings((prev) => prev.map((b) =>
        b.id === bookingId
          ? { ...b, status: updated.status as BookingStatus, no_show_set_at: updated.no_show_set_at ?? null }
          : b
      ));
    }
    setSaving(null);
  }

  // ── Reschedule modal handlers ─────────────────────────────────────────────

  async function handleOpenReschedule(b: BookingWithDetails) {
    setRescheduleBooking(b);
    setRescheduleStep(1);
    setRescheduleEmployeeId(b.employee?.id ?? 'any');
    setRescheduleDate('');
    setRescheduleSlots([]);
    setRescheduleSlot(null);
    setRescheduleError('');
    setLoadingEmp(true);
    try {
      const params = new URLSearchParams({ shopId: b.shop_id });
      if (b.service_id) params.set('serviceId', b.service_id);
      const res = await fetch(`/api/employees/available?${params}`);
      const data = res.ok ? await res.json() : [];
      setRescheduleEmployees(data ?? []);
    } catch {
      setRescheduleEmployees([]);
    } finally {
      setLoadingEmp(false);
    }
  }

  function handleBarberChange(empId: string) {
    setRescheduleEmployeeId(empId);
    setRescheduleDate('');
    setRescheduleSlots([]);
    setRescheduleSlot(null);
  }

  async function handleFetchSlots(date: string) {
    if (!rescheduleBooking) return;
    setRescheduleDate(date);
    setRescheduleSlots([]);
    setRescheduleSlot(null);
    setRescheduleError('');
    setLoadingSlots(true);
    try {
      let serviceId: string | null = rescheduleBooking.service_id;
      if (!serviceId) {
        const svcRes = await fetch(`/api/services?shopId=${rescheduleBooking.shop_id}`);
        if (svcRes.ok) {
          const svcs: { id: string }[] = await svcRes.json();
          serviceId = svcs[0]?.id ?? null;
        }
      }
      if (!serviceId) {
        setRescheduleError('Unable to load times. Please reschedule from the booking detail page.');
        return;
      }
      const params = new URLSearchParams({
        shopId:     rescheduleBooking.shop_id,
        employeeId: rescheduleEmployeeId,
        date,
        serviceId,
      });
      const res = await fetch(`/api/slots?${params}`);
      if (!res.ok) throw new Error('Failed');
      const slots = await res.json();
      const slotList: TimeSlot[] = Array.isArray(slots) ? slots : [];
      setRescheduleSlots(slotList);
      if (slotList.length > 0) setRescheduleStep(3);
    } catch {
      setRescheduleSlots([]);
      setRescheduleError('Could not load available times. Please try again.');
    } finally {
      setLoadingSlots(false);
    }
  }

  async function handleConfirmReschedule() {
    if (!rescheduleBooking || !rescheduleSlot) return;
    setRescheduleSaving(true);
    setRescheduleError('');
    try {
      const resolvedEmpId = rescheduleSlot.employeeId
        ?? (rescheduleEmployeeId !== 'any' ? rescheduleEmployeeId : undefined);

      const body: Record<string, unknown> = {
        action:    'reschedule',
        startTime: rescheduleSlot.start,
      };
      if (resolvedEmpId) body.newEmployeeId = resolvedEmpId;

      const res = await fetch(`/api/bookings/${rescheduleBooking.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (res.status === 409) {
        setRescheduleError('That slot is no longer available. Please pick a different time.');
        setRescheduleSlot(null);
        setRescheduleStep(3);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setRescheduleError(err.error ?? 'Failed to reschedule booking.');
        return;
      }

      const updated = await res.json() as {
        start_time: string; end_time: string; status: string; employee_id: string | null;
      };

      setBookings((prev) => prev.map((b) => {
        if (b.id !== rescheduleBooking.id) return b;
        const newEmpId   = updated.employee_id ?? b.employee_id;
        const newEmpName = rescheduleSlot.employeeName
          ?? rescheduleEmployees.find((e) => e.id === newEmpId)?.name
          ?? b.employee?.name
          ?? '';
        return {
          ...b,
          start_time:  updated.start_time,
          end_time:    updated.end_time,
          status:      updated.status as BookingStatus,
          employee_id: updated.employee_id,
          employee:    newEmpId ? { id: newEmpId, name: newEmpName } : b.employee,
        };
      }));

      setRescheduleBooking(null);
      showToast('Booking rescheduled successfully.');
    } catch {
      setRescheduleError('Failed to reschedule booking. Please try again.');
    } finally {
      setRescheduleSaving(false);
    }
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const maxStr   = format(addDays(new Date(), 60), 'yyyy-MM-dd');
  const hasFilter = !!(filterShop || filterStatus || filterDateFrom || filterDateTo || search || searchInput);

  function clearFilters() {
    setFilterShop('');
    setFilterStatus('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setSearchInput('');
    setSearch('');
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Bookings</h1>
        <p className="text-gray-400 text-sm">Full booking log with filters</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6 p-4 bg-dark-100 border border-dark-300 rounded-xl">
        {/* Search — debounced 400 ms */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search customer name or email…"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        <select
          value={filterShop}
          onChange={(e) => { setFilterShop(e.target.value); }}
          className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
        >
          <option value="">All shops</option>
          {shops.map((s) => <option key={s.id} value={s.id} className="bg-dark-200">{s.name}</option>)}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value as BookingStatus | ''); }}
          className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
        >
          <option value="">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="checked_in">Checked In</option>
          <option value="completed">Completed</option>
          <option value="no_show">No Show</option>
          <option value="cancelled">Cancelled</option>
          <option value="rescheduled">Rescheduled</option>
          <option value="pending_reschedule">Action Required</option>
        </select>

        {/* Server-side date range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
          />
          <span className="text-gray-500 text-sm">–</span>
          <input
            type="date"
            value={filterDateTo}
            min={filterDateFrom || undefined}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        {hasFilter && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-8">
          <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          Loading bookings…
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16 bg-dark-100 border border-dark-300 rounded-2xl">
          <CalendarRange className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No bookings found.</p>
        </div>
      ) : (
        <div className="bg-dark-100 border border-dark-300 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-300 bg-dark-200">
                  <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Ref</th>
                  <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Customer</th>
                  <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Barber</th>
                  <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Shop</th>
                  <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Date &amp; Time</th>
                  <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Status</th>
                  <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-300">
                {bookings.map((b) => {
                  const tz            = b.shop?.timezone ?? 'UTC';
                  const isPast        = new Date(b.start_time) < new Date();
                  const isBusy        = saving === b.id;
                  const canReschedule = ['confirmed', 'rescheduled', 'checked_in'].includes(b.status);
                  const canCancel     = ['confirmed', 'rescheduled', 'checked_in'].includes(b.status);
                  // Fix 2: first 8 chars of UUID in uppercase as reference
                  const ref           = `#${b.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

                  return (
                    <tr key={b.id} className="hover:bg-dark-200/50 transition-colors">
                      <td className="px-4 py-3">
                        <code className="text-xs text-gray-500 font-mono">{ref}</code>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium">{b.customer?.full_name ?? 'Unknown'}</div>
                        <div className="text-xs text-gray-500">{b.customer?.email}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">{b.employee?.name ?? 'Unassigned'}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{b.shop?.name}</td>
                      <td className="px-4 py-3 text-sm text-gold">{formatDateTimeInZone(b.start_time, tz)}</td>
                      <td className="px-4 py-3"><Badge status={b.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5 items-center">

                          {/* Fix 3: View Details link */}
                          <Link
                            href={`/booking/${b.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-dark-400/50 transition-colors"
                            title="View booking details"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>

                          {/* Undo No Show within 10-minute window */}
                          {b.status === 'no_show' && withinUndoWindow(b.no_show_set_at) && (
                            <Button variant="secondary" size="sm" loading={isBusy} onClick={() => handleStatusTransition(b.id, 'confirmed')} className="flex items-center gap-1 !text-xs !px-2.5 !py-1">
                              <RotateCcw className="w-3 h-3" /> Undo No Show
                            </Button>
                          )}

                          {/* Reschedule button */}
                          {canReschedule && (
                            <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => handleOpenReschedule(b)} className="!text-xs !px-2.5 !py-1">
                              Reschedule
                            </Button>
                          )}

                          {/* Cancel for confirmed, rescheduled, checked_in */}
                          {canCancel && (
                            <Button variant="danger" size="sm" loading={isBusy} onClick={() => handleCancel(b.id)}>
                              Cancel
                            </Button>
                          )}

                          {/* Operational recovery for past stuck bookings */}
                          {isPast && (b.status === 'confirmed' || b.status === 'checked_in') && (
                            <>
                              <button onClick={() => handleStatusTransition(b.id, 'completed')} disabled={isBusy} className="px-2 py-1 text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
                                Mark Completed
                              </button>
                              <button onClick={() => handleStatusTransition(b.id, 'no_show')} disabled={isBusy} className="px-2 py-1 text-xs font-medium bg-gray-500/10 text-gray-400 border border-gray-500/20 rounded-lg hover:bg-gray-500/20 transition-colors disabled:opacity-50">
                                No Show
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          <div className="px-4 py-3 border-t border-dark-300 flex items-center justify-between gap-4 flex-wrap">
            <span className="text-xs text-gray-500">
              {totalCount === 0
                ? 'No bookings'
                : `Showing ${(page - 1) * PAGE_LIMIT + 1}–${Math.min(page * PAGE_LIMIT, totalCount)} of ${totalCount} bookings`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchBookings(page - 1)}
                  disabled={page <= 1 || loading}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-dark-400/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
                <button
                  onClick={() => fetchBookings(page + 1)}
                  disabled={page >= totalPages || loading}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-dark-400/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reschedule modal */}
      {rescheduleBooking && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-100 border border-dark-300 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6">

            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-semibold">Reschedule Appointment</h2>
                <p className="text-xs text-gray-500 mt-0.5">{rescheduleBooking.customer?.full_name ?? 'Unknown'}</p>
              </div>
              <button
                onClick={() => setRescheduleBooking(null)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-dark-400/50 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-1.5 mb-6">
              {([1, 2, 3] as const).map((s) => (
                <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${s <= rescheduleStep ? 'bg-gold' : 'bg-dark-400'}`} />
              ))}
            </div>

            {/* Step 1 — Barber */}
            {rescheduleStep === 1 && (
              <div>
                <p className="text-sm text-gray-400 mb-4">Select a barber for this appointment</p>
                {loadingEmp ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                    <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                    Loading barbers…
                  </div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    <button onClick={() => handleBarberChange('any')} className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${rescheduleEmployeeId === 'any' ? 'bg-gold/10 border-gold text-white' : 'bg-dark-200 border-dark-400 text-gray-300 hover:border-gold/50'}`}>
                      Any Available
                    </button>
                    {rescheduleEmployees.map((emp) => (
                      <button key={emp.id} onClick={() => handleBarberChange(emp.id)} className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${rescheduleEmployeeId === emp.id ? 'bg-gold/10 border-gold text-white' : 'bg-dark-200 border-dark-400 text-gray-300 hover:border-gold/50'}`}>
                        {emp.name}
                        {emp.id === rescheduleBooking.employee?.id && <span className="ml-2 text-xs text-gray-500">(current)</span>}
                      </button>
                    ))}
                  </div>
                )}
                <Button className="w-full mt-4" onClick={() => setRescheduleStep(2)}>Next: Select Date →</Button>
              </div>
            )}

            {/* Step 2 — Date */}
            {rescheduleStep === 2 && (
              <div>
                <p className="text-sm text-gray-400 mb-4">
                  Select a new date
                  {rescheduleEmployeeId !== 'any' && (
                    <> for <span className="text-white">{rescheduleEmployees.find((e) => e.id === rescheduleEmployeeId)?.name ?? 'the selected barber'}</span></>
                  )}
                </p>
                <input
                  type="date"
                  min={todayStr}
                  max={maxStr}
                  value={rescheduleDate}
                  onChange={(e) => { if (e.target.value) handleFetchSlots(e.target.value); }}
                  className="w-full px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
                />
                {loadingSlots && (
                  <div className="flex items-center gap-2 text-gray-400 text-sm mt-4">
                    <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                    Loading available times…
                  </div>
                )}
                {rescheduleDate && !loadingSlots && rescheduleSlots.length === 0 && !rescheduleError && (
                  <p className="text-sm text-gray-500 mt-4 text-center py-2">No available times on this date. Try another date.</p>
                )}
                {rescheduleError && <p className="mt-3 text-sm text-red-400">{rescheduleError}</p>}
                <Button variant="ghost" className="w-full mt-4" onClick={() => { setRescheduleStep(1); setRescheduleDate(''); setRescheduleError(''); }}>← Back to Barber</Button>
              </div>
            )}

            {/* Step 3 — Time + Confirmation */}
            {rescheduleStep === 3 && rescheduleBooking && (() => {
              const tz = rescheduleBooking.shop?.timezone ?? 'UTC';
              const resolvedEmpId   = rescheduleSlot?.employeeId ?? (rescheduleEmployeeId !== 'any' ? rescheduleEmployeeId : null);
              const resolvedEmpName = rescheduleSlot?.employeeName
                ?? rescheduleEmployees.find((e) => e.id === resolvedEmpId)?.name
                ?? rescheduleBooking.employee?.name ?? '';
              const barberChanged = resolvedEmpId !== null
                && resolvedEmpId !== rescheduleBooking.employee?.id
                && resolvedEmpName !== rescheduleBooking.employee?.name;

              return (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-gray-400">Available times on <span className="text-white">{rescheduleDate}</span></p>
                    <button onClick={() => { setRescheduleStep(2); setRescheduleSlot(null); setRescheduleError(''); }} className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2">Change date</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                    {rescheduleSlots.map((slot) => {
                      const isSelected = rescheduleSlot?.start === slot.start;
                      return (
                        <button key={slot.start} onClick={() => setRescheduleSlot(slot)} className={`px-2 py-2.5 text-sm rounded-lg border transition-colors ${isSelected ? 'bg-gold/10 border-gold text-white font-medium' : 'bg-dark-200 border-dark-400 text-gray-300 hover:border-gold/50'}`}>
                          {formatTimeInZone(slot.start, tz)}
                          {slot.employeeName && rescheduleEmployeeId === 'any' && (
                            <span className="block text-xs text-gray-500 truncate mt-0.5">{slot.employeeName}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {rescheduleSlot && (
                    <div className="mt-4 p-4 bg-dark-200 rounded-xl border border-dark-400">
                      <p className="text-xs text-gray-500 uppercase font-medium tracking-wide mb-3">Confirm reschedule</p>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm"><span className="text-gray-500">Customer</span><span className="text-white">{rescheduleBooking.customer?.full_name ?? 'Unknown'}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-gray-500">From</span><span className="text-gray-500 line-through text-xs">{formatDateTimeInZone(rescheduleBooking.start_time, tz)}</span></div>
                        <div className="flex justify-between text-sm"><span className="text-gray-500">To</span><span className="text-gold font-medium">{formatDateTimeInZone(rescheduleSlot.start, tz)}</span></div>
                        {barberChanged && <div className="flex justify-between text-sm"><span className="text-gray-500">New barber</span><span className="text-white">{resolvedEmpName}</span></div>}
                      </div>
                    </div>
                  )}
                  {rescheduleError && <p className="mt-3 text-sm text-red-400 text-center">{rescheduleError}</p>}
                  <div className="flex gap-2 mt-4">
                    <Button variant="ghost" className="flex-1" onClick={() => { setRescheduleStep(2); setRescheduleSlot(null); setRescheduleError(''); }}>← Back</Button>
                    <Button className="flex-1" disabled={!rescheduleSlot} loading={rescheduleSaving} onClick={handleConfirmReschedule}>Confirm Reschedule</Button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl border text-sm font-medium shadow-lg ${toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
