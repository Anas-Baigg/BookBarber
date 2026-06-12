import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import BookingDetailClient from './BookingDetailClient';
import type { BookingWithDetails, Role } from '@/types';
import { Scissors, Calendar, User, Clock } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import { formatDateInZone, formatTimeInZone } from '@/lib/utils';

export default async function BookingPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const [{ data: profile }, { data: rawBooking }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase
      .from('bookings')
      .select(`
        id, status, start_time, end_time, notes, reschedule_deadline, was_pending_reschedule, service_id,
        shop:shops(id, name, address, slug, timezone),
        employee:employees(id, name),
        customer:profiles!bookings_customer_id_fkey(id, full_name, email)
      `)
      .eq('id', params.id)
      .single(),
  ]);

  if (!rawBooking) notFound();

  const booking    = rawBooking as unknown as BookingWithDetails;
  const userRole: Role = (profile?.role as Role) ?? 'customer';

  // Fix 6: differentiate cancelled booking pages for customers
  if (booking.status === 'cancelled' && userRole === 'customer') {
    const shopSlug = booking.shop?.slug;
    const timezone = booking.shop?.timezone ?? 'UTC';
    const bookAgainLink = shopSlug ? (
      <Link
        href={`/shop/${shopSlug}`}
        className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-gold text-dark font-semibold rounded-xl hover:opacity-90 transition-opacity"
      >
        <Scissors className="w-4 h-4" />
        Book a New Appointment
      </Link>
    ) : (
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 px-6 py-3 bg-dark-200 border border-dark-400 text-white font-semibold rounded-xl hover:bg-dark-300 transition-colors"
      >
        Back to Dashboard
      </Link>
    );

    // Scenario A: booking went through pending_reschedule before being cancelled
    if (booking.was_pending_reschedule) {
      return (
        <div className="min-h-screen bg-dark">
          <Navbar />
          <main className="max-w-lg mx-auto px-4 sm:px-6 pt-24 pb-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
              <Scissors className="w-7 h-7 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold mb-3">Reschedule Link No Longer Active</h1>
            <p className="text-gray-400 mb-2">
              This reschedule link is no longer active. Your original appointment was cancelled.
            </p>
            <p className="text-gray-500 text-sm mb-8">
              You can book a new appointment using the link below.
            </p>
            {bookAgainLink}
          </main>
        </div>
      );
    }

    // Scenario B: normal cancellation — show neutral page with booking details for reference
    return (
      <div className="min-h-screen bg-dark">
        <Navbar />
        <main className="max-w-lg mx-auto px-4 sm:px-6 pt-24 pb-16">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-dark-200 border border-dark-400 flex items-center justify-center mx-auto mb-6">
              <Scissors className="w-7 h-7 text-gray-400" />
            </div>
            <h1 className="text-2xl font-bold mb-2">This Appointment Has Been Cancelled</h1>
            <p className="text-gray-400 text-sm">The appointment details are shown below for your reference.</p>
          </div>

          <div className="bg-dark-100 border border-dark-300 rounded-2xl p-6 mb-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-dark-300 flex items-center justify-center flex-shrink-0">
                <Scissors className="w-4 h-4 text-gray-400" />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Shop</div>
                <div className="font-medium text-sm">{booking.shop?.name}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-dark-300 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-gray-400" />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Barber</div>
                <div className="font-medium text-sm">{booking.employee?.name ?? 'Unassigned'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-dark-300 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-4 h-4 text-gray-400" />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Date</div>
                <div className="font-medium text-sm">{formatDateInZone(booking.start_time, timezone)}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-dark-300 flex items-center justify-center flex-shrink-0">
                <Clock className="w-4 h-4 text-gray-400" />
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Time</div>
                <div className="font-medium text-sm">
                  {formatTimeInZone(booking.start_time, timezone)} — {formatTimeInZone(booking.end_time, timezone)}
                </div>
              </div>
            </div>
          </div>

          <div className="text-center">{bookAgainLink}</div>
        </main>
      </div>
    );
  }

  return <BookingDetailClient booking={booking} userRole={userRole} />;
}
