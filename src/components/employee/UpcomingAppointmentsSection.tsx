'use client';

import { format } from 'date-fns';
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
  const today    = format(toZonedTime(new Date(), timezone), 'yyyy-MM-dd');
  const tomorrow = format(toZonedTime(new Date(Date.now() + 86400000), timezone), 'yyyy-MM-dd');
  const label = format(d, 'EEEE, MMMM d');
  if (dateStr === tomorrow) return `Tomorrow — ${label}`;
  return label;
}

export default function UpcomingAppointmentsSection({ upcomingBookings, timezone }: Props) {
  const pending   = upcomingBookings.filter((b) => b.status === 'pending_reschedule');
  const confirmed = upcomingBookings.filter((b) => b.status !== 'pending_reschedule');

  // Group confirmed/rescheduled by date in shop timezone
  const groups: Record<string, BookingWithDetails[]> = {};
  for (const b of confirmed) {
    const day = format(toZonedTime(new Date(b.start_time), timezone), 'yyyy-MM-dd');
    (groups[day] ??= []).push(b);
  }
  const sortedDays = Object.keys(groups).sort();

  if (pending.length === 0 && confirmed.length === 0) return null;

  return (
    <div className="mb-8 space-y-6">
      {/* Pending customer action section */}
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

      {/* Upcoming appointments grouped by date */}
      {confirmed.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-gold" />
            Upcoming Appointments
          </h2>
          <div className="space-y-5">
            {sortedDays.map((day) => (
              <div key={day}>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
                  {formatGroupHeading(day, timezone)}
                </div>
                <div className="space-y-2">
                  {groups[day].map((b) => (
                    <div
                      key={b.id}
                      className="flex items-start justify-between p-4 bg-dark-100 border border-dark-300 rounded-xl"
                    >
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
                      <Badge status={b.status} className="flex-shrink-0 ml-2" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
