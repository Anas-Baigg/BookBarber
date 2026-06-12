import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Navbar from '@/components/layout/Navbar';
import Card from '@/components/ui/Card';
import { getDayName } from '@/lib/utils';
import { getTodayBoundsUTC } from '@/lib/booking-time';
import type { BookingWithDetails, EmployeeWithSchedule, EmployeeScheduleOverride, TimeOffRequest } from '@/types';
import { User, Scissors, AlertTriangle } from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import TodayAppointmentsSection from '@/components/employee/TodayAppointmentsSection';
import UpcomingAppointmentsSection from '@/components/employee/UpcomingAppointmentsSection';
import PastBookingsSection from '@/components/employee/PastBookingsSection';
import TimeOffRequestSection from '@/components/employee/TimeOffRequestSection';

export const metadata = { title: 'My Schedule' };

export default async function EmployeePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('id', user.id)
    .single();

  if (!profile || !['employee', 'admin'].includes(profile.role)) {
    redirect('/dashboard');
  }

  const { data: employee } = await supabase
    .from('employees')
    .select('*, employee_schedules(*), shop:shops(id, name, timezone)')
    .eq('user_id', user.id)
    .single();

  if (!employee) {
    return (
      <div className="min-h-screen bg-dark">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-24 pb-16">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-1">My Schedule</h1>
            <p className="text-gray-400">{profile.email}</p>
          </div>
          <Card>
            <div className="text-center py-8">
              <User className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">Your employee profile hasn&apos;t been set up yet.</p>
              <p className="text-sm text-gray-500 mt-1">Contact your shop administrator.</p>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  const shopData = (employee as { shop?: { id?: string; name?: string; timezone?: string } }).shop;
  const timezone  = shopData?.timezone ?? 'UTC';
  const now       = new Date();
  const { start: todayStart, end: todayEnd } = getTodayBoundsUTC(timezone);
  const sixtyDaysOut = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  // Five parallel targeted queries — no past bookings in initial load
  const [
    { data: rawTodayBookings },
    { data: rawUpcomingBookings },
    { data: rawCheckedIn },
    { data: rawNextConfirmed },
    { data: rawOverrides },
    { data: rawTimeOffRequests },
  ] = await Promise.all([
    // Today's: non-cancelled bookings within today's timezone-aware bounds
    supabase
      .from('bookings')
      .select(`*, employee:employees(id, name), shop:shops(id, name, timezone),
               customer:profiles!bookings_customer_id_fkey(id, full_name, email)`)
      .eq('employee_id', employee.id)
      .neq('status', 'cancelled')
      .gte('start_time', todayStart.toISOString())
      .lte('start_time', todayEnd.toISOString())
      .order('start_time', { ascending: true }),

    // Upcoming: confirmed/rescheduled/pending_reschedule, after today, next 60 days
    supabase
      .from('bookings')
      .select(`*, employee:employees(id, name), shop:shops(id, name, timezone),
               customer:profiles!bookings_customer_id_fkey(id, full_name, email)`)
      .eq('employee_id', employee.id)
      .in('status', ['confirmed', 'rescheduled', 'pending_reschedule', 'checked_in'])
      .gt('start_time', todayEnd.toISOString())
      .lte('start_time', sixtyDaysOut)
      .order('start_time', { ascending: true }),

    // Currently in chair (checked_in today) — preferred over next confirmed
    supabase
      .from('bookings')
      .select(`*, employee:employees(id, name), shop:shops(id, name, timezone),
               customer:profiles!bookings_customer_id_fkey(id, full_name, email)`)
      .eq('employee_id', employee.id)
      .eq('status', 'checked_in')
      .gte('start_time', todayStart.toISOString())
      .lte('start_time', todayEnd.toISOString())
      .order('start_time', { ascending: true })
      .limit(1),

    // Next confirmed appointment (future)
    supabase
      .from('bookings')
      .select(`*, employee:employees(id, name), shop:shops(id, name, timezone),
               customer:profiles!bookings_customer_id_fkey(id, full_name, email)`)
      .eq('employee_id', employee.id)
      .eq('status', 'confirmed')
      .gt('start_time', now.toISOString())
      .order('start_time', { ascending: true })
      .limit(1),

    // Overrides next 30 days — use shop timezone so the lower bound is the
    // shop's local "today", not the UTC date (which diverges on Vercel).
    supabase
      .from('employee_schedule_overrides')
      .select('*')
      .eq('employee_id', employee.id)
      .gte('date', format(toZonedTime(now, timezone), 'yyyy-MM-dd'))
      .lte('date', format(toZonedTime(addDays(now, 30), timezone), 'yyyy-MM-dd'))
      .order('date', { ascending: true }),

    // Time off requests: last 90 days + all pending — prevents unbounded scan over time
    supabase
      .from('time_off_requests')
      .select('*')
      .eq('employee_id', employee.id)
      .or(`date.gte.${format(subDays(now, 90), 'yyyy-MM-dd')},status.eq.pending`)
      .order('date', { ascending: false })
      .limit(50),
  ]);

  const todayBookings   = (rawTodayBookings   as BookingWithDetails[]) ?? [];
  const upcomingBookings = (rawUpcomingBookings as BookingWithDetails[]) ?? [];
  const checkedInNow     = ((rawCheckedIn      as BookingWithDetails[]) ?? [])[0] ?? null;
  const nextConfirmedApt = ((rawNextConfirmed  as BookingWithDetails[]) ?? [])[0] ?? null;
  const nextAppointment  = checkedInNow ?? nextConfirmedApt;
  const upcomingOverrides = (rawOverrides as EmployeeScheduleOverride[]) ?? [];
  const timeOffRequests  = (rawTimeOffRequests as TimeOffRequest[]) ?? [];

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-24 pb-16">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-1">My Schedule</h1>
          <p className="text-gray-400">
            {shopData?.name ?? ''} — {profile.full_name ?? profile.email}
          </p>
        </div>

        {/* ── Next appointment + Today's appointments (client: status transitions) */}
        <section className="mb-8">
          <TodayAppointmentsSection
            todayBookings={todayBookings}
            nextAppointment={nextAppointment}
            timezone={timezone}
          />
        </section>

        {/* ── Upcoming: pending action + grouped by date ─────────────────── */}
        <UpcomingAppointmentsSection
          upcomingBookings={upcomingBookings}
          timezone={timezone}
        />

        {/* ── Weekly schedule + exceptions + time off ─────────────────────── */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Scissors className="w-5 h-5 text-gold" />
            My Weekly Schedule
          </h2>
          <Card>
            <div className="space-y-2">
              {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                const sched = (employee as unknown as EmployeeWithSchedule).employee_schedules.find(
                  (s) => s.day_of_week === day
                );
                const isOff = sched?.is_off ?? true;
                return (
                  <div key={day} className="flex items-center justify-between py-2 border-b border-dark-300 last:border-0">
                    <span className="text-sm text-gray-300 w-32">{getDayName(day)}</span>
                    {isOff ? (
                      <span className="text-xs text-gray-500 bg-dark-300 px-2 py-1 rounded">Off</span>
                    ) : (
                      <span className="text-sm text-gold font-medium">
                        {sched?.start_time?.slice(0, 5)} — {sched?.end_time?.slice(0, 5)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Upcoming exceptions (next 30 days) */}
          {upcomingOverrides.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <h3 className="text-sm font-medium text-gray-400 flex items-center gap-1.5 mb-2">
                <AlertTriangle className="w-4 h-4 text-orange-400" />
                Upcoming Exceptions
              </h3>
              {upcomingOverrides.map((ov) => (
                <div
                  key={ov.id}
                  className="flex flex-col px-3 py-2 bg-dark-100 border border-dark-300 rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">
                      {format(new Date(ov.date + 'T12:00:00'), 'EEE, MMM d')}
                    </span>
                    <div className="flex items-center gap-2">
                      {ov.is_working ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          {ov.start_time && ov.end_time
                            ? `${ov.start_time.slice(0, 5)} – ${ov.end_time.slice(0, 5)}`
                            : 'Extra Day'}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                          Day Off
                        </span>
                      )}
                      <span className="text-xs text-gray-600 capitalize">{ov.reason.replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                  {ov.notes && (
                    <p className="text-xs text-gray-500 mt-0.5">{ov.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Time off requests (client: modal + list) */}
          <TimeOffRequestSection initialRequests={timeOffRequests} />
        </section>

        {/* ── Past appointments (client: self-fetching, paginated, searchable) */}
        <PastBookingsSection timezone={timezone} />
      </main>
    </div>
  );
}
