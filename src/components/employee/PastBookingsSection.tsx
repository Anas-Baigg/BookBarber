'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { formatDateTimeInZone } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import type { BookingWithDetails, BookingStatus } from '@/types';
import { Clock, ChevronLeft, ChevronRight, Search, X, AlertCircle } from 'lucide-react';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '',             label: 'All statuses' },
  { value: 'confirmed',    label: 'Confirmed'    },
  { value: 'completed',    label: 'Completed'    },
  { value: 'no_show',      label: 'No Show'      },
  { value: 'cancelled',    label: 'Cancelled'    },
  { value: 'rescheduled',  label: 'Rescheduled'  },
];

interface ApiResponse {
  bookings:     BookingWithDetails[];
  totalCount:   number;
  page:         number;
  totalPages:   number;
  searchCapped?: boolean;
}

interface FetchParams {
  page:      number;
  search:    string;
  status:    string;
  dateMode:  'single' | 'range';
  date:      string;
  startDate: string;
  endDate:   string;
}

export default function PastBookingsSection({ timezone }: { timezone: string }) {
  const [bookings,     setBookings]     = useState<BookingWithDetails[]>([]);
  const [totalCount,   setTotalCount]   = useState(0);
  const [totalPages,   setTotalPages]   = useState(0);
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [status,       setStatus]       = useState('');
  const [dateMode,     setDateMode]     = useState<'single' | 'range'>('single');
  const [date,         setDate]         = useState('');
  const [startDate,    setStartDate]    = useState('');
  const [endDate,      setEndDate]      = useState('');
  const [loading,      setLoading]      = useState(true);
  const [debouncing,   setDebouncing]   = useState(false);
  const [searchCapped, setSearchCapped] = useState(false);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // All params passed explicitly so there are no stale-closure issues
  const fetchBookings = useCallback(async (params: FetchParams) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(params.page), limit: String(PAGE_SIZE) });
      if (params.search.trim())                              qs.set('search', params.search.trim());
      if (params.status)                                     qs.set('status', params.status);
      if (params.dateMode === 'single' && params.date)       qs.set('date', params.date);
      if (params.dateMode === 'range'  && params.startDate)  qs.set('startDate', params.startDate);
      if (params.dateMode === 'range'  && params.endDate)    qs.set('endDate', params.endDate);

      const res = await window.fetch(`/api/employee/bookings/past?${qs}`);
      if (res.ok) {
        const data: ApiResponse = await res.json();
        setBookings(data.bookings);
        setTotalCount(data.totalCount);
        setTotalPages(data.totalPages);
        setSearchCapped(data.searchCapped ?? false);
        setPage(data.page);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchBookings({ page: 1, search: '', status: '', dateMode: 'single', date: '', startDate: '', endDate: '' });
  }, [fetchBookings]);

  // ── Search — debounced 400 ms ──────────────────────────────────────────────
  function handleSearchChange(val: string) {
    setSearch(val);
    setDebouncing(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncing(false);
      setPage(1);
      fetchBookings({ page: 1, search: val, status, dateMode, date, startDate, endDate });
    }, 400);
  }

  // ── Status ────────────────────────────────────────────────────────────────
  function handleStatusChange(val: string) {
    setStatus(val);
    setPage(1);
    fetchBookings({ page: 1, search, status: val, dateMode, date, startDate, endDate });
  }

  // ── Single date ───────────────────────────────────────────────────────────
  function handleDateChange(val: string) {
    setDate(val);
    setPage(1);
    fetchBookings({ page: 1, search, status, dateMode, date: val, startDate, endDate });
  }

  function clearDate() {
    setDate('');
    setPage(1);
    fetchBookings({ page: 1, search, status, dateMode, date: '', startDate, endDate });
  }

  // ── Date range ────────────────────────────────────────────────────────────
  function handleStartDateChange(val: string) {
    setStartDate(val);
    setPage(1);
    fetchBookings({ page: 1, search, status, dateMode, date, startDate: val, endDate });
  }

  function handleEndDateChange(val: string) {
    setEndDate(val);
    setPage(1);
    fetchBookings({ page: 1, search, status, dateMode, date, startDate, endDate: val });
  }

  function clearDateRange() {
    setStartDate('');
    setEndDate('');
    setPage(1);
    fetchBookings({ page: 1, search, status, dateMode, date, startDate: '', endDate: '' });
  }

  // ── Date mode toggle ──────────────────────────────────────────────────────
  function switchDateMode(mode: 'single' | 'range') {
    setDateMode(mode);
    setDate('');
    setStartDate('');
    setEndDate('');
    setPage(1);
    fetchBookings({ page: 1, search, status, dateMode: mode, date: '', startDate: '', endDate: '' });
  }

  // ── Pagination ────────────────────────────────────────────────────────────
  function handlePageChange(newPage: number) {
    setPage(newPage);
    fetchBookings({ page: newPage, search, status, dateMode, date, startDate, endDate });
  }

  // ── Clear all ─────────────────────────────────────────────────────────────
  function clearAllFilters() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearch('');
    setStatus('');
    setDate('');
    setStartDate('');
    setEndDate('');
    setDebouncing(false);
    setPage(1);
    fetchBookings({ page: 1, search: '', status: '', dateMode, date: '', startDate: '', endDate: '' });
  }

  const hasActiveFilters = search !== '' || status !== '' || date !== '' || startDate !== '' || endDate !== '';

  return (
    <section>
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-400">
        <Clock className="w-5 h-5" />
        Past Appointments
      </h2>

      {/* Filter bar */}
      <div className="space-y-3 mb-4">

        {/* Row 1: search + status */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search customer…"
              className="w-full pl-9 pr-8 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gold"
            />
            {debouncing && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
            )}
          </div>
          <select
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Row 2: date filter */}
        <div className="flex flex-wrap items-center gap-2">
          {dateMode === 'single' ? (
            <>
              <label className="text-xs text-gray-400 whitespace-nowrap">Filter by date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => handleDateChange(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              />
              {date && (
                <button
                  onClick={clearDate}
                  aria-label="Clear date"
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => switchDateMode('range')}
                className="text-xs text-gold hover:text-gold-light transition-colors ml-1"
              >
                Range
              </button>
            </>
          ) : (
            <>
              <label className="text-xs text-gray-400 whitespace-nowrap">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              />
              <label className="text-xs text-gray-400 whitespace-nowrap">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              />
              {(startDate || endDate) && (
                <button
                  onClick={clearDateRange}
                  aria-label="Clear date range"
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => switchDateMode('single')}
                className="text-xs text-gold hover:text-gold-light transition-colors ml-1"
              >
                Single date
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search cap hint */}
      {searchCapped && (
        <div className="flex items-start gap-2 p-3 mb-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>Showing results for the first 100 matching customers. Narrow your search for more precise results.</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
          <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-8 bg-dark-100 border border-dark-300 rounded-xl">
          {hasActiveFilters ? (
            <>
              <p className="text-gray-500 text-sm mb-3">No bookings match your filters.</p>
              <button
                onClick={clearAllFilters}
                className="text-xs text-gold hover:text-gold-light transition-colors"
              >
                Clear all filters
              </button>
            </>
          ) : (
            <p className="text-gray-500 text-sm">No past appointments found.</p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {bookings.map((b) => (
              <Link
                key={b.id}
                href={`/booking/${b.id}`}
                className="flex items-center justify-between p-3 bg-dark-100/50 border border-dark-300/50 rounded-lg hover:border-dark-400 hover:bg-dark-100 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-dark-300 flex items-center justify-center text-xs flex-shrink-0">
                    {b.customer?.full_name?.charAt(0) ?? '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-gray-300 truncate">{b.customer?.full_name ?? 'Unknown'}</div>
                    <div className="text-xs text-gray-500">{formatDateTimeInZone(b.start_time, timezone)}</div>
                    {b.notes && (
                      <div className="text-xs text-gray-600 truncate">{b.notes}</div>
                    )}
                  </div>
                </div>
                <Badge status={b.status as BookingStatus} />
              </Link>
            ))}
          </div>

          {/* Pagination — hidden when only 1 page */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <span className="text-xs text-gray-500">
                Page {page} of {totalPages} ({totalCount} total)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-dark-400 text-gray-400 hover:text-white hover:border-dark-500 disabled:opacity-40 transition-all"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </button>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-dark-400 text-gray-400 hover:text-white hover:border-dark-500 disabled:opacity-40 transition-all"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
