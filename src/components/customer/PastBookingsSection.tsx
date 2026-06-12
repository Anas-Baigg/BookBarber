'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDateTimeInZone } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import type { BookingStatus } from '@/types';
import { Clock, Scissors } from 'lucide-react';

interface PastBooking {
  id: string;
  start_time: string;
  status: BookingStatus;
  employee: { id: string; name: string } | null;
  shop: { id: string; name: string; timezone: string; slug: string } | null;
}

const LIMIT = 10;

const STATUS_OPTIONS = [
  { value: '',            label: 'All statuses'  },
  { value: 'completed',   label: 'Completed'     },
  { value: 'no_show',     label: 'No Show'       },
  { value: 'cancelled',   label: 'Cancelled'     },
  { value: 'rescheduled', label: 'Rescheduled'   },
];

export default function PastBookingsSection() {
  const [bookings,   setBookings]   = useState<PastBooking[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page,       setPage]       = useState(1);
  const [status,     setStatus]     = useState('');
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const totalPages  = Math.max(1, Math.ceil(totalCount / LIMIT));
  const fetchingRef = useRef(false);

  const fetchPast = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) params.set('status', status);
    try {
      const res = await fetch(`/api/customer/bookings/past?${params}`);
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings ?? []);
        setTotalCount(data.totalCount ?? 0);
      } else {
        setError('Could not load booking history. Please try again.');
      }
    } catch {
      setError('Could not load booking history. Please try again.');
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [page, status]);

  useEffect(() => { fetchPast(); }, [fetchPast]);

  function handleStatusChange(next: string) {
    setStatus(next);
    setPage(1);
  }

  // Don't render section at all if no past bookings, no active filter, and no error
  if (!loading && !error && totalCount === 0 && !status) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-400">
          <Clock className="w-5 h-5" />
          Past Appointments
          {totalCount > 0 && (
            <span className="text-xs text-gray-500 font-normal">({totalCount})</span>
          )}
        </h2>
        <select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-xs focus:outline-none focus:ring-1 focus:ring-gold"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} className="bg-dark-200">{o.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-6">
          <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="py-4">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button
            onClick={fetchPast}
            className="text-sm text-gold underline font-medium hover:opacity-80 transition-opacity"
          >
            Try again
          </button>
        </div>
      ) : bookings.length === 0 ? (
        <p className="text-gray-500 text-sm py-4">No bookings match the selected filter.</p>
      ) : (
        <>
          <div className="space-y-2 mb-4">
            {bookings.map((b) => {
              const tz = b.shop?.timezone ?? 'UTC';
              return (
                <Link
                  key={b.id}
                  href={`/booking/${b.id}`}
                  className="block p-4 bg-dark-100/50 border border-dark-300/50 rounded-xl hover:border-dark-400 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-dark-300 flex items-center justify-center">
                        <Scissors className="w-4 h-4 text-gray-400" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-300">{b.shop?.name}</div>
                        <div className="text-xs text-gray-500">
                          {formatDateTimeInZone(b.start_time, tz)}
                          {b.employee?.name && <span> · {b.employee.name}</span>}
                        </div>
                      </div>
                    </div>
                    <Badge status={b.status} />
                  </div>
                </Link>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
              >
                ← Previous
              </Button>
              <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || loading}
              >
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
