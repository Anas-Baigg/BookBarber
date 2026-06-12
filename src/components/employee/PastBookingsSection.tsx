'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { formatDateTimeInZone } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import type { BookingWithDetails, BookingStatus } from '@/types';
import { Clock, ChevronLeft, ChevronRight, Search } from 'lucide-react';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '',             label: 'All statuses'  },
  { value: 'confirmed',    label: 'Confirmed'     },
  { value: 'completed',    label: 'Completed'     },
  { value: 'no_show',      label: 'No Show'       },
  { value: 'cancelled',    label: 'Cancelled'     },
  { value: 'rescheduled',  label: 'Rescheduled'   },
];

interface ApiResponse {
  bookings: BookingWithDetails[];
  total: number;
  page: number;
  limit: number;
}

export default function PastBookingsSection({ timezone }: { timezone: string }) {
  const [bookings, setBookings] = useState<BookingWithDetails[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [search,   setSearch]   = useState('');
  const [status,   setStatus]   = useState('');
  const [loading,  setLoading]  = useState(true);

  const fetchingRef = useRef(false);

  const fetchBookings = useCallback(async (p: number, s: string) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (s) params.set('status', s);
      const res = await window.fetch(`/api/employee/bookings/past?${params}`);
      if (res.ok) {
        const data: ApiResponse = await res.json();
        setBookings(data.bookings);
        setTotal(data.total);
        setPage(data.page);
      }
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => { fetchBookings(1, status); }, [status, fetchBookings]);

  function handlePageChange(newPage: number) {
    fetchBookings(newPage, status);
    setSearch(''); // clear local search on page change
  }

  // Client-side search filters the current page
  const filtered = search
    ? bookings.filter((b) =>
        b.customer?.full_name?.toLowerCase().includes(search.toLowerCase())
      )
    : bookings;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <section>
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-400">
        <Clock className="w-5 h-5" />
        Past Appointments
      </h2>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
          <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 bg-dark-100 border border-dark-300 rounded-xl">
          <p className="text-gray-500 text-sm">No past appointments found.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {filtered.map((b) => (
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

          {/* Pagination */}
          {totalPages > 1 && !search && (
            <div className="flex items-center justify-between mt-4 px-1">
              <span className="text-xs text-gray-500">
                Page {page} of {totalPages} ({total} total)
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
